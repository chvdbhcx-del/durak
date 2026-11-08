//! The rules of Durak, a line-for-line port of `src/engine/game.ts` and `cards.ts`.
//! The TypeScript engine stays the source of truth for the table; this copy exists so the bots can
//! play thousands of moves ahead quickly. `tests/parity` checks the two agree move for move.

use serde::{Deserialize, Serialize};

pub const HAND_SIZE: usize = 6;
pub const SUITS: [char; 4] = ['S', 'H', 'D', 'C'];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Card {
    pub id: String,
    #[serde(with = "suit_str")]
    pub suit: char,
    pub rank: i32,
}

mod suit_str {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(c: &char, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&c.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<char, D::Error> {
        let s = String::deserialize(d)?;
        s.chars().next().ok_or_else(|| serde::de::Error::custom("empty suit"))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Easy,
    Normal,
    Hard,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Podkidnoy,
    Perevodnoy,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub players: usize,
    pub deck_size: usize,
    pub mode: Mode,
    #[serde(default)]
    pub cheat: Option<bool>,
    #[serde(default)]
    pub level: Option<Level>,
    #[serde(default)]
    pub seed: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Player {
    pub id: usize,
    pub hand: Vec<Card>,
    pub human: bool,
    pub out: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pair {
    pub attack: Card,
    pub defense: Option<Card>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub options: Options,
    pub players: Vec<Player>,
    pub deck: Vec<Card>,
    #[serde(with = "suit_str")]
    pub trump: char,
    pub trump_card: Card,
    pub table: Vec<Pair>,
    pub discard: Vec<Card>,
    pub attacker: usize,
    pub defender: usize,
    pub taking: bool,
    pub passed: Vec<usize>,
    pub limit: usize,
    pub over: bool,
    pub loser: Option<usize>,
    #[serde(default)]
    pub caught: Option<Vec<usize>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum Action {
    Attack { card_id: String },
    Throw { card_ids: Vec<String> },
    Defend { card_id: String, pair: usize },
    Transfer { card_id: String },
    Take,
    Pass,
    Bluff { card_id: String, pair: usize },
    Accuse { pair: usize },
}

impl Action {
    pub fn card_id(&self) -> Option<&str> {
        match self {
            Action::Attack { card_id } | Action::Defend { card_id, .. } | Action::Transfer { card_id } | Action::Bluff { card_id, .. } => Some(card_id),
            _ => None,
        }
    }
}

pub fn beats(defense: &Card, attack: &Card, trump: char) -> bool {
    if defense.suit == attack.suit {
        return defense.rank > attack.rank;
    }
    defense.suit == trump
}

pub fn make_deck(size: usize) -> Vec<Card> {
    let low = if size == 24 { 9 } else if size == 36 { 6 } else { 2 };
    let mut deck = Vec::with_capacity(size);
    for suit in SUITS {
        for rank in low..=14 {
            deck.push(Card { id: format!("{}{}", suit, rank), suit, rank });
        }
    }
    deck
}

/// Same generator as `mulberry32` in cards.ts, bit for bit.
pub struct Mulberry32(u32);

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Mulberry32(seed)
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

/// `(a + b + …) >>> 0` in JavaScript: a sum of whole numbers taken modulo 2^32.
pub fn to_u32(x: f64) -> u32 {
    let m = x.rem_euclid(4294967296.0);
    m as u32
}

pub fn seed_of(s: &GameState) -> f64 {
    s.options.seed.unwrap_or(1.0)
}

fn next_active(s: &GameState, from: usize) -> usize {
    let n = s.players.len();
    for k in 1..=n {
        let i = (from + k) % n;
        if !s.players[i].out {
            return i;
        }
    }
    from
}

pub fn attack_order(s: &GameState) -> Vec<usize> {
    let n = s.players.len();
    let mut order = Vec::new();
    for k in 0..n {
        let i = (s.attacker + k) % n;
        if i != s.defender && !s.players[i].out {
            order.push(i);
        }
    }
    order
}

fn unbeaten(s: &GameState) -> usize {
    s.table.iter().filter(|p| p.defense.is_none()).count()
}

fn table_has_rank(s: &GameState, rank: i32) -> bool {
    s.table.iter().any(|p| p.attack.rank == rank || p.defense.as_ref().map_or(false, |d| d.rank == rank))
}

pub fn current_actor(s: &GameState) -> Option<usize> {
    if s.over {
        return None;
    }
    if s.table.is_empty() {
        return Some(s.attacker);
    }
    if !s.taking && unbeaten(s) > 0 {
        return Some(s.defender);
    }
    attack_order(s).into_iter().find(|p| !s.passed.contains(p))
}

fn can_throw_more(s: &GameState) -> bool {
    s.table.len() < s.limit && unbeaten(s) < s.players[s.defender].hand.len()
}

pub fn can_cheat(s: &GameState, player: usize) -> bool {
    s.options.cheat.unwrap_or(false) && s.players[player].human && !s.caught.as_ref().map_or(false, |c| c.contains(&player))
}

fn throw_in_cards(s: &GameState, player: usize) -> Vec<Card> {
    if !can_throw_more(s) {
        return vec![];
    }
    if can_cheat(s, player) {
        return s.players[player].hand.clone();
    }
    s.players[player].hand.iter().filter(|c| table_has_rank(s, c.rank)).cloned().collect()
}

fn transfer_target(s: &GameState) -> usize {
    next_active(s, s.defender)
}

fn can_transfer(s: &GameState) -> bool {
    if s.options.mode != Mode::Perevodnoy || s.taking || s.table.is_empty() {
        return false;
    }
    if s.table.iter().any(|p| p.defense.is_some()) {
        return false;
    }
    let rank = s.table[0].attack.rank;
    if s.table.iter().any(|p| p.attack.rank != rank) {
        return false;
    }
    let target = transfer_target(s);
    target != s.defender && s.players[target].hand.len() >= s.table.len() + 1 && s.table.len() + 1 <= HAND_SIZE
}

fn may_throw_anytime(s: &GameState, player: usize) -> bool {
    match s.players.get(player) {
        Some(p) => !s.over && !p.out && player != s.defender && !s.table.is_empty(),
        None => false,
    }
}

pub fn legal_actions(s: &GameState, player: usize) -> Vec<Action> {
    if current_actor(s) != Some(player) {
        if may_throw_anytime(s, player) {
            return throw_in_cards(s, player).into_iter().map(|c| Action::Attack { card_id: c.id }).collect();
        }
        return vec![];
    }
    let hand = &s.players[player].hand;
    if s.table.is_empty() {
        return hand.iter().map(|c| Action::Attack { card_id: c.id.clone() }).collect();
    }
    if player == s.defender && !s.taking {
        let mut actions = Vec::new();
        let anything = can_cheat(s, player);
        for (i, p) in s.table.iter().enumerate() {
            if p.defense.is_some() {
                continue;
            }
            for c in hand {
                if anything || beats(c, &p.attack, s.trump) {
                    actions.push(Action::Defend { card_id: c.id.clone(), pair: i });
                }
            }
        }
        if can_transfer(s) {
            let rank = s.table[0].attack.rank;
            for c in hand {
                if c.rank == rank {
                    actions.push(Action::Transfer { card_id: c.id.clone() });
                }
            }
        }
        actions.push(Action::Take);
        return actions;
    }
    let mut out: Vec<Action> = throw_in_cards(s, player).into_iter().map(|c| Action::Attack { card_id: c.id }).collect();
    out.push(Action::Pass);
    out
}

fn remove_from_hand(p: &mut Player, card_id: &str) -> Result<Card, String> {
    match p.hand.iter().position(|c| c.id == card_id) {
        Some(i) => Ok(p.hand.remove(i)),
        None => Err(format!("card {} not in hand", card_id)),
    }
}

/// `applyAction` for the moves bots weigh: plain legal moves, with no cheating at the table.
pub fn apply_action(prev: &GameState, player: usize, action: &Action) -> Result<GameState, String> {
    let s = preview_action(prev, player, action)?;
    Ok(settle(s))
}

pub fn preview_action(prev: &GameState, player: usize, action: &Action) -> Result<GameState, String> {
    if !legal_actions(prev, player).iter().any(|a| a == action) {
        return Err("illegal action".into());
    }
    let mut s = prev.clone();
    match action {
        Action::Attack { card_id } => {
            let c = remove_from_hand(&mut s.players[player], card_id)?;
            s.table.push(Pair { attack: c, defense: None });
            s.passed.clear();
        }
        Action::Defend { card_id, pair } => {
            let c = remove_from_hand(&mut s.players[player], card_id)?;
            s.table[*pair].defense = Some(c);
            s.passed.clear();
        }
        Action::Transfer { card_id } => {
            let c = remove_from_hand(&mut s.players[player], card_id)?;
            s.table.push(Pair { attack: c, defense: None });
            s.attacker = s.defender;
            s.defender = transfer_target(&s);
            s.limit = HAND_SIZE.min(s.players[s.defender].hand.len());
            s.passed.clear();
        }
        Action::Take => {
            s.taking = true;
            s.passed.clear();
        }
        Action::Pass => s.passed.push(player),
        _ => return Err("not a bot move".into()),
    }
    Ok(s)
}

fn settle(mut s: GameState) -> GameState {
    if s.table.is_empty() || (!s.taking && unbeaten(&s) > 0) {
        return s;
    }
    for id in attack_order(&s) {
        if s.passed.contains(&id) {
            continue;
        }
        if (s.players[id].human && !s.players[id].hand.is_empty()) || !throw_in_cards(&s, id).is_empty() {
            return s;
        }
        s.passed.push(id);
    }
    end_round(s)
}

fn end_round(mut s: GameState) -> GameState {
    let mut cards = Vec::new();
    for p in s.table.drain(..) {
        cards.push(p.attack);
        if let Some(d) = p.defense {
            cards.push(d);
        }
    }
    let took = s.taking;
    if took {
        let d = s.defender;
        s.players[d].hand.extend(cards);
    } else {
        s.discard.extend(cards);
    }
    let mut draw_order = attack_order(&s);
    draw_order.push(s.defender);
    for id in draw_order {
        while s.players[id].hand.len() < HAND_SIZE {
            match s.deck.pop() {
                Some(c) => s.players[id].hand.push(c),
                None => break,
            }
        }
    }
    if s.deck.is_empty() {
        for p in s.players.iter_mut() {
            if p.hand.is_empty() {
                p.out = true;
            }
        }
    }
    let active: Vec<usize> = s.players.iter().filter(|p| !p.out).map(|p| p.id).collect();
    if active.len() <= 1 {
        s.over = true;
        s.loser = active.first().copied();
        s.taking = false;
        s.passed.clear();
        return s;
    }
    let old_defender = s.defender;
    s.attacker = if took || s.players[old_defender].out { next_active(&s, old_defender) } else { old_defender };
    s.defender = next_active(&s, s.attacker);
    s.limit = HAND_SIZE.min(s.players[s.defender].hand.len());
    s.taking = false;
    s.passed.clear();
    s
}
