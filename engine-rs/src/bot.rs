//! The bots, a line-for-line port of `src/engine/bot.ts`. Same heuristics, same dice, same order of
//! moves, so a game played here goes exactly as it would in TypeScript; only faster.

use crate::game::*;
use std::collections::{HashMap, HashSet};

pub const EASY_SLIP: f64 = 0.25;
const BLUFF_CHANCE: f64 = 0.3;
pub const SAMPLES: usize = 24;
pub const MIN_SAMPLES: usize = 6;

fn bluff_chance(level: Level) -> f64 {
    match level {
        Level::Easy => 0.4,
        Level::Hard => 0.15,
        Level::Normal => BLUFF_CHANCE,
    }
}

fn value(c: &Card, trump: char) -> i32 {
    c.rank + if c.suit == trump { 20 } else { 0 }
}

fn face(c: &Card) -> (char, i32) {
    (c.suit, c.rank)
}

fn card_by_id<'a>(s: &'a GameState, player: usize, id: &str) -> &'a Card {
    s.players[player].hand.iter().find(|c| c.id == id).expect("card in hand")
}

/// Time source and thinking budget: the browser's clock in WebAssembly, none in native tests.
pub struct Budget {
    pub now: fn() -> f64,
    pub ms: f64,
}

#[derive(Clone)]
struct Step {
    card_id: String,
    pair: usize,
}

fn plan_defense(s: &GameState, player: usize) -> Option<Vec<Step>> {
    let mut pool = s.players[player].hand.clone();
    pool.sort_by_key(|c| value(c, s.trump));
    let mut open: Vec<(usize, &Card)> = s.table.iter().enumerate().filter(|(_, p)| p.defense.is_none()).map(|(i, p)| (i, &p.attack)).collect();
    open.sort_by(|a, b| value(b.1, s.trump).cmp(&value(a.1, s.trump)));
    let mut plan = Vec::new();
    for (pair, attack) in open {
        let i = pool.iter().position(|c| beats(c, attack, s.trump))?;
        plan.push(Step { card_id: pool[i].id.clone(), pair });
        pool.remove(i);
    }
    Some(plan)
}

fn known_faces(s: &GameState, player: usize) -> HashSet<(char, i32)> {
    let mut known = HashSet::new();
    for c in &s.discard {
        known.insert(face(c));
    }
    for c in &s.players[player].hand {
        known.insert(face(c));
    }
    for p in &s.table {
        known.insert(face(&p.attack));
        if let Some(d) = &p.defense {
            known.insert(face(d));
        }
    }
    known
}

fn unseen_cards(s: &GameState, player: usize) -> Vec<Card> {
    let mut known = known_faces(s, player);
    known.insert(face(&s.trump_card));
    make_deck(s.options.deck_size).into_iter().filter(|c| !known.contains(&face(c))).collect()
}

fn cover_risk(card: &Card, unseen: &[Card], trump: char) -> f64 {
    if unseen.is_empty() {
        return 0.0;
    }
    unseen.iter().filter(|u| beats(u, card, trump)).count() as f64 / unseen.len() as f64
}

fn dice(s: &GameState, player: usize, salt: f64) -> f64 {
    let x = seed_of(s) + s.deck.len() as f64 * 13.0 + s.discard.len() as f64 * 7.0 + s.table.len() as f64 * 17.0 + s.players[player].hand.len() as f64 * 29.0 + salt;
    Mulberry32::new(to_u32(x)).next()
}

fn level_of(s: &GameState) -> Level {
    s.options.level.unwrap_or(Level::Normal)
}

pub fn choose_action(s: &GameState, player: usize, level: Option<Level>, fast: bool, budget: &Budget) -> Result<Action, String> {
    let level = level.unwrap_or_else(|| level_of(s));
    let legal = legal_actions(s, player);
    if legal.is_empty() {
        return Err("Bot has no legal action".into());
    }
    if level != Level::Easy && !fast {
        let reach = if level == Level::Hard { 6 } else { 3 };
        if let Some(a) = solve_endgame(s, player, &legal, reach) {
            return Ok(a);
        }
    }
    if level == Level::Hard && !fast {
        if let Some(a) = look_ahead(s, player, &legal, budget) {
            return Ok(a);
        }
    }
    if level == Level::Easy && dice(s, player, 3.0) < EASY_SLIP {
        if let Some(a) = easy_slip(s, player, &legal) {
            return Ok(a);
        }
    }
    let trump = s.trump;
    let endgame = s.deck.is_empty();
    let by_value = |a: &Action, b: &Action| value(card_by_id(s, player, a.card_id().unwrap()), trump).cmp(&value(card_by_id(s, player, b.card_id().unwrap()), trump));
    let hard = level == Level::Hard;
    let unseen = if hard { unseen_cards(s, player) } else { vec![] };

    if s.table.is_empty() {
        return Ok(Action::Attack { card_id: choose_lead(s, player, level, &unseen).id.clone() });
    }

    if player == s.defender && !s.taking {
        let mut transfers: Vec<Action> = legal.iter().filter(|a| matches!(a, Action::Transfer { .. })).cloned().collect();
        transfers.sort_by(|a, b| by_value(a, b));
        if let Some(t) = transfers.first() {
            let c = card_by_id(s, player, t.card_id().unwrap());
            if c.suit != trump || endgame {
                return Ok(t.clone());
            }
        }
        let plan = match plan_defense(s, player) {
            Some(p) => p,
            None => return Ok(bluff_or_take(s, player, level)),
        };
        if level == Level::Easy {
            let spend: i32 = plan.iter().map(|st| value(card_by_id(s, player, &st.card_id), trump)).sum();
            let cheap_table = s.table.iter().all(|p| p.attack.suit != trump && p.attack.rank <= 9);
            if !endgame && s.deck.len() > 8 && cheap_table && spend > 30 * plan.len() as i32 && s.table.len() == 1 {
                return Ok(Action::Take);
            }
            return Ok(Action::Defend { card_id: plan[0].card_id.clone(), pair: plan[0].pair });
        }
        return Ok(if worth_defending(s, player, &plan) { Action::Defend { card_id: plan[0].card_id.clone(), pair: plan[0].pair } } else { Action::Take });
    }

    let mut throws: Vec<Action> = legal.iter().filter(|a| matches!(a, Action::Attack { .. })).cloned().collect();
    throws.sort_by(|a, b| by_value(a, b));
    for t in throws {
        let c = card_by_id(s, player, t.card_id().unwrap());
        if level == Level::Easy {
            if (c.suit != trump && c.rank <= if s.taking { 12 } else { 11 }) || endgame {
                return Ok(t);
            }
            continue;
        }
        if worth_throwing(s, player, c, level, &unseen) {
            return Ok(t);
        }
    }
    Ok(Action::Pass)
}

#[derive(PartialEq, Eq, Hash)]
struct Key {
    hands: Vec<Vec<String>>,
    table: Vec<(String, Option<String>)>,
    attacker: usize,
    defender: usize,
    taking: bool,
    passed: Vec<usize>,
}

fn key(g: &GameState) -> Key {
    Key {
        hands: g
            .players
            .iter()
            .map(|p| {
                let mut ids: Vec<String> = p.hand.iter().map(|c| c.id.clone()).collect();
                ids.sort();
                ids
            })
            .collect(),
        table: g.table.iter().map(|p| (p.attack.id.clone(), p.defense.as_ref().map(|d| d.id.clone()))).collect(),
        attacker: g.attacker,
        defender: g.defender,
        taking: g.taking,
        passed: g.passed.clone(),
    }
}

fn without_cheats(s: &GameState) -> GameState {
    let mut w = s.clone();
    w.options.cheat = Some(false);
    w
}

fn solve_endgame(s: &GameState, player: usize, legal: &[Action], reach: usize) -> Option<Action> {
    if !s.deck.is_empty() || s.over {
        return None;
    }
    let others: Vec<usize> = (0..s.players.len()).filter(|&i| i != player && !s.players[i].out).collect();
    if others.len() != 1 {
        return None;
    }
    let foe = others[0];
    let known = known_faces(s, player);
    let hidden: Vec<Card> = make_deck(s.options.deck_size).into_iter().filter(|c| !known.contains(&face(c))).collect();
    if hidden.len() != s.players[foe].hand.len() || hidden.len() > reach {
        return None;
    }
    let mut world = without_cheats(s);
    world.players[foe].hand = hidden;
    let moves: Vec<&Action> = legal.iter().filter(|a| !matches!(a, Action::Bluff { .. })).collect();
    if moves.len() < 2 {
        return None;
    }
    let mut budget: i64 = 7000;
    let mut memo: HashMap<Key, i32> = HashMap::new();

    fn search(g: &GameState, player: usize, budget: &mut i64, memo: &mut HashMap<Key, i32>) -> Result<i32, ()> {
        if g.over {
            return Ok(match g.loser {
                None => 0,
                Some(l) if l == player => -1,
                _ => 1,
            });
        }
        let k = key(g);
        if let Some(&hit) = memo.get(&k) {
            return Ok(hit);
        }
        *budget -= 1;
        if *budget < 0 {
            return Err(());
        }
        let actor = match current_actor(g) {
            Some(a) => a,
            None => return Ok(0),
        };
        let mine = actor == player;
        let mut best = if mine { -2 } else { 2 };
        for a in legal_actions(g, actor) {
            if matches!(a, Action::Bluff { .. }) {
                continue;
            }
            let next = apply_action(g, actor, &a).map_err(|_| ())?;
            let v = search(&next, player, budget, memo)?;
            if if mine { v > best } else { v < best } {
                best = v;
            }
            if best == if mine { 1 } else { -1 } {
                break;
            }
        }
        memo.insert(k, best);
        Ok(best)
    }

    let mut best_v = -2;
    let mut pick: Option<Action> = None;
    for a in moves {
        let next = apply_action(&world, player, a).ok()?;
        let v = search(&next, player, &mut budget, &mut memo).ok()?;
        if v > best_v {
            best_v = v;
            pick = Some(a.clone());
        }
    }
    pick
}

fn look_ahead(s: &GameState, player: usize, legal: &[Action], budget: &Budget) -> Option<Action> {
    let moves: Vec<&Action> = legal.iter().filter(|a| !matches!(a, Action::Bluff { .. })).collect();
    if moves.len() < 2 || s.over {
        return None;
    }
    let foes: Vec<usize> = s.players.iter().filter(|p| p.id != player && !p.out).map(|p| p.id).collect();
    if foes.is_empty() {
        return None;
    }
    let mut known = known_faces(s, player);
    if !s.deck.is_empty() {
        known.insert(face(&s.trump_card));
    }
    let pool: Vec<Card> = make_deck(s.options.deck_size).into_iter().filter(|c| !known.contains(&face(c))).collect();
    let in_hands: usize = foes.iter().map(|&f| s.players[f].hand.len()).sum();
    let in_deck = s.deck.len().saturating_sub(1);
    if pool.len() != in_hands + in_deck {
        return None;
    }
    let fallback = choose_action(s, player, Some(Level::Normal), true, budget).ok()?;
    let x = seed_of(s) + s.deck.len() as f64 * 131.0 + s.discard.len() as f64 * 17.0 + s.table.len() as f64 * 29.0 + s.players[player].hand.len() as f64 * 43.0 + 7.0;
    let mut rnd = Mulberry32::new(to_u32(x));
    // Cards everyone watched an opponent pick up go back to that opponent in every guess.
    let mut free = pool;
    let mut taken: Vec<Vec<Card>> = Vec::with_capacity(foes.len());
    for &f in &foes {
        let mut mine = Vec::new();
        if let Some(faces) = s.seen.as_ref().and_then(|m| m.get(&f.to_string())) {
            for fc in faces {
                if let Some(i) = free.iter().position(|c| format!("{}{}", c.suit, c.rank) == *fc) {
                    if mine.len() < s.players[f].hand.len() {
                        mine.push(free.remove(i));
                    }
                }
            }
        }
        taken.push(mine);
    }
    let mut score = vec![0i32; moves.len()];
    let start = (budget.now)();
    let mut done = 0usize;
    let base = without_cheats(s);
    for _ in 0..SAMPLES {
        let mut cards = free.clone();
        let mut i = cards.len();
        while i > 1 {
            i -= 1;
            let j = (rnd.next() * (i + 1) as f64).floor() as usize;
            cards.swap(i, j);
        }
        let mut world = base.clone();
        let mut at = 0;
        for (k, &f) in foes.iter().enumerate() {
            let n = s.players[f].hand.len() - taken[k].len();
            let mut hand = taken[k].clone();
            hand.extend_from_slice(&cards[at..at + n]);
            world.players[f].hand = hand;
            at += n;
        }
        if !world.deck.is_empty() {
            let bottom = world.deck[0].clone();
            let mut deck = vec![bottom];
            deck.extend_from_slice(&cards[at..]);
            world.deck = deck;
        }
        for (i, m) in moves.iter().enumerate() {
            let next = apply_action(&world, player, m).ok()?;
            score[i] += play_out(next, player, budget);
        }
        done += 1;
        if done >= MIN_SAMPLES && (budget.now)() - start > budget.ms {
            break;
        }
    }
    let mut best = 0;
    for i in 1..moves.len() {
        if score[i] > score[best] {
            best = i;
        }
    }
    if let Some(habit) = moves.iter().position(|m| **m == fallback) {
        if ((score[best] - score[habit]) as f64) < done as f64 * 0.12 {
            return Some(moves[habit].clone());
        }
    }
    Some(moves[best].clone())
}

fn play_out(start: GameState, player: usize, budget: &Budget) -> i32 {
    let mut g = start;
    let mut i = 0;
    while i < 400 && !g.over {
        let actor = match current_actor(&g) {
            Some(a) => a,
            None => break,
        };
        let a = match choose_action(&g, actor, Some(Level::Normal), true, budget) {
            Ok(a) => a,
            Err(_) => break,
        };
        g = match apply_action(&g, actor, &a) {
            Ok(n) => n,
            Err(_) => break,
        };
        i += 1;
    }
    if !g.over {
        return 0;
    }
    match g.loser {
        None => 0,
        Some(l) if l == player => -1,
        _ => 1,
    }
}

#[derive(PartialEq)]
enum Phase {
    Early,
    Mid,
    Late,
}

fn phase_of(s: &GameState) -> Phase {
    if s.deck.len() > 12 {
        Phase::Early
    } else if !s.deck.is_empty() {
        Phase::Mid
    } else {
        Phase::Late
    }
}

fn worth_defending(s: &GameState, player: usize, plan: &[Step]) -> bool {
    let phase = phase_of(s);
    if phase == Phase::Late {
        return true;
    }
    let hand = &s.players[player].hand;
    let spent: Vec<&Card> = plan.iter().map(|st| card_by_id(s, player, &st.card_id)).collect();
    let on_table: usize = s.table.iter().map(|p| 1 + p.defense.is_some() as usize).sum();
    let tolerance = if phase == Phase::Early { 3 } else { 2 };
    if hand.len() + on_table > 10 {
        return true;
    }
    let trump_on_plain = plan.iter().any(|st| card_by_id(s, player, &st.card_id).suit == s.trump && s.table[st.pair].attack.suit != s.trump);
    let high_trump = spent.iter().any(|c| c.suit == s.trump && c.rank >= 12);
    let big_spend = spent.iter().map(|c| value(c, s.trump)).sum::<i32>() > 30 * plan.len() as i32;
    let cheap_attack = s.table.iter().all(|p| p.attack.rank <= 10);
    if on_table <= tolerance && trump_on_plain && cheap_attack {
        return false;
    }
    if on_table + 1 <= tolerance && (high_trump || big_spend) && cheap_attack {
        return false;
    }
    true
}

fn worth_throwing(s: &GameState, player: usize, c: &Card, level: Level, unseen: &[Card]) -> bool {
    let phase = phase_of(s);
    let taking = s.taking;
    let hand = &s.players[player].hand;
    if c.suit == s.trump {
        return phase == Phase::Late && (hand.len() <= 2 || taking);
    }
    let aim = if taking { 3 } else { 2 };
    if phase != Phase::Late && s.table.len() >= aim {
        return false;
    }
    let cap = if level == Level::Hard && taking && phase != Phase::Early {
        14
    } else if phase == Phase::Early {
        if taking { 10 } else { 8 }
    } else if phase == Phase::Mid {
        if taking { 12 } else { 9 }
    } else {
        14
    };
    if c.rank > cap {
        return false;
    }
    if level == Level::Hard && !taking && phase != Phase::Late && cover_risk(c, unseen, s.trump) > 0.55 {
        return false;
    }
    true
}

fn choose_lead<'a>(s: &'a GameState, player: usize, level: Level, unseen: &[Card]) -> &'a Card {
    let hand = &s.players[player].hand;
    let trump = s.trump;
    let count = |c: &Card| hand.iter().filter(|o| o.rank == c.rank).count() as i32;
    let mut sorted: Vec<&Card> = hand.iter().collect();
    if level == Level::Hard && phase_of(s) == Phase::Late {
        let k = |c: &Card| value(c, trump) as f64 + cover_risk(c, unseen, trump) * 30.0 - (count(c) * 3) as f64;
        sorted.sort_by(|a, b| k(a).partial_cmp(&k(b)).unwrap_or(std::cmp::Ordering::Equal));
        return sorted[0];
    }
    let early = phase_of(s) != Phase::Late;
    let tier = |c: &Card| if c.suit == trump { 2 } else if early && c.rank >= 13 { 1 } else { 0 };
    sorted.sort_by(|a, b| tier(a).cmp(&tier(b)).then_with(|| (value(a, trump) - (count(a) - 1) * 3).cmp(&(value(b, trump) - (count(b) - 1) * 3))));
    sorted[0]
}

fn easy_slip(s: &GameState, player: usize, legal: &[Action]) -> Option<Action> {
    if s.table.is_empty() {
        let leads: Vec<&Action> = legal.iter().filter(|a| matches!(a, Action::Attack { .. })).collect();
        if leads.is_empty() {
            return None;
        }
        let i = (dice(s, player, 5.0) * leads.len() as f64).floor() as usize;
        return Some(leads[i].clone());
    }
    if player == s.defender && !s.taking && legal.iter().any(|a| *a == Action::Take) {
        return Some(Action::Take);
    }
    None
}

fn bluff_or_take(s: &GameState, player: usize, level: Level) -> Action {
    let caught = s.caught.as_ref().map_or(false, |c| c.contains(&player));
    let watched = s.options.cheat.unwrap_or(false) && !caught && attack_order(s).iter().any(|&id| id != player && !s.players[id].out);
    let pair = s.table.iter().position(|p| p.defense.is_none());
    let pair = match (watched, pair) {
        (true, Some(p)) => p,
        _ => return Action::Take,
    };
    let x = seed_of(s) + s.deck.len() as f64 * 11.0 + s.discard.len() as f64 * 5.0 + s.table.len() as f64 * 19.0 + s.players[player].hand.len() as f64 * 23.0;
    let mut roll = Mulberry32::new(to_u32(x));
    if roll.next() >= bluff_chance(level) {
        return Action::Take;
    }
    let mut hand: Vec<&Card> = s.players[player].hand.iter().collect();
    hand.sort_by_key(|c| value(c, s.trump));
    Action::Bluff { card_id: hand[0].id.clone(), pair }
}
