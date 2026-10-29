import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseAction } from '../engine/bot'
import { botReaction, botReply, type Emote, fingerprint } from '../engine/emotes'
import { Action, applyAction, currentActor, GameState, maxPlayers, newGame } from '../engine/game'
import { normalizeCode, setRoomServer } from '../net/room'
import { useFriends } from '../net/useFriends'
import { hasSavedRoom, useOnline } from '../net/useOnline'
import { GameScreen, Result, Series } from './GameScreen'
import { FriendToast } from './FriendToast'
import { FriendsPanel } from './FriendsPanel'
import { RulesPanel, StatsPanel } from './InfoPanels'
import { MainMenu } from './MainMenu'
import { setHaptics, syncStatusBar, tap } from './native'
import { OnlineScreen } from './OnlineScreen'
import { BOT_NAMES } from './pickers'
import { PlayScreen } from './PlayScreen'
import { SettingsPanel } from './SettingsPanel'
import { addResult, applyLook, applyTheme, BOT_DELAY, deviceToken, EMPTY_STATS, loadSettings, loadStats, saveSettings, saveStats, Settings, Stats } from './settings'
import { setSoundEnabled, unlockSound } from './sfx'
import { UpdateToast } from './UpdateToast'
import { applyIfIdle, startUpdates, UpdateState } from './updates'

const ME = 0
type Screen = 'menu' | 'play' | 'online' | 'game'
type Panel = 'settings' | 'rules' | 'stats' | 'friends'

// The bot game is saved as it goes, so closing or reloading the app never loses a hand.
const GAME_KEY = 'durak.game'
function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(GAME_KEY)
    const g = raw ? (JSON.parse(raw) as GameState) : null
    return g && !g.over ? g : null
  } catch {
    return null
  }
}
function saveGame(g: GameState | null) {
  try {
    if (g && !g.over) localStorage.setItem(GAME_KEY, JSON.stringify(g))
    else localStorage.removeItem(GAME_KEY)
  } catch {
    /* storage unavailable */
  }
}

function startGame(s: Settings): GameState {
  const players = Math.min(s.opponents + 1, maxPlayers(s.deckSize))
  return newGame({ players, deckSize: s.deckSize, mode: s.mode, cheat: s.cheat, names: ['Вы', ...BOT_NAMES], human: ME, level: s.difficulty, seed: Date.now() })
}

/** A room code from an invite link like …/durak/#join-AB3CD, plus the private server a link may carry (&s=…). */
function inviteFromHash(): { code: string; server: string } {
  const m = /^#join-([A-Za-z0-9]+)(?:&s=(.+))?/.exec(window.location.hash)
  if (!m) return { code: '', server: '' }
  let server = ''
  try {
    server = m[2] ? decodeURIComponent(m[2]) : ''
  } catch {
    /* a mangled link just falls back to the public server */
  }
  return { code: normalizeCode(m[1]), server }
}

export function App() {
  const [invite] = useState(inviteFromHash)
  const [settings, setSettings] = useState<Settings>(() => {
    const s = loadSettings()
    return invite.server ? { ...s, server: invite.server } : s
  })
  setRoomServer(settings.server)
  const [stats, setStats] = useState<Stats>(loadStats)
  const [game, setGame] = useState<GameState | null>(loadGame)
  const [series, setSeries] = useState<Series | null>(null)
  const [localEmote, setLocalEmote] = useState<Emote | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const inviteCode = invite.code
  const [resumeRoom] = useState(() => !inviteCode && hasSavedRoom())
  const [screen, setScreen] = useState<Screen>(inviteCode || resumeRoom ? 'online' : 'menu')
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })
  const [token] = useState(deviceToken)
  const friends = useFriends(settings.name, settings.server)
  const online = useOnline(token, friends.fid)

  useEffect(() => {
    applyTheme(settings.theme)
    syncStatusBar()
  }, [settings.theme])
  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => applyLook(settings.cardBack, settings.tableStyle), [settings.cardBack, settings.tableStyle])
  useEffect(() => setHaptics(settings.haptics), [settings.haptics])
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound])
  useEffect(() => unlockSound(), [])
  // A downloaded update switches in only while nobody is mid-game (and right away if the player taps it).
  const busyRef = useRef(false)
  const inRound = screen === 'game' || (screen === 'online' && online.phase === 'playing')
  busyRef.current = inRound
  useEffect(() => startUpdates(setUpdate, () => busyRef.current), [])
  useEffect(() => {
    if (!busyRef.current) applyIfIdle()
  }, [inRound])
  useEffect(() => saveGame(game), [game])
  useEffect(() => {
    if (resumeRoom) online.restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (inviteCode) history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [inviteCode])

  // Callbacks handed to the table stay stable, so a re-render doesn't restart its bot timer.
  const onlineRef = useRef(online)
  onlineRef.current = online
  const stepOnlineBot = useCallback((actor: number) => onlineRef.current.stepBot(actor), [])
  const stepLocalBot = useCallback((actor: number) => setGame((g) => (g && currentActor(g) === actor ? applyAction(g, actor, chooseAction(g, actor)) : g)), [])
  // The finished game's setup goes into the history, so keep the live game in a ref.
  const liveRef = useRef<{ game: GameState | null; online: boolean }>({ game: null, online: false })
  const liveOnline = screen === 'online' && online.phase === 'playing' && online.game
  liveRef.current = { game: liveOnline || (screen === 'game' ? game : null), online: !!liveOnline }
  const recordResult = useCallback((result: Result, loser: number | null) => {
    const g = liveRef.current.game
    if (!liveRef.current.online)
      setSeries((cur) => (cur && cur.played < cur.total ? { ...cur, played: cur.played + 1, fools: cur.fools.map((n, i) => (i === loser ? n + 1 : n)) } : cur))
    setStats((s) => {
      const next = addResult(s, { at: Date.now(), result, mode: g?.options.mode ?? 'podkidnoy', deck: g?.options.deckSize ?? 36, players: g?.players.length ?? 2, online: liveRef.current.online, level: g?.options.level, cheat: !!g?.options.cheat })
      saveStats(next)
      return next
    })
  }, [])

  // Bots react to what happens at the table, and now and then answer a person's emote.
  // They run wherever the game does: on this device for bot games, on the host for rooms.
  const botGame = liveOnline ? (online.role === 'host' ? liveOnline : null) : screen === 'game' ? game : null
  const emoteRef = useRef({ prev: null as GameState | null, at: 0 })
  const showEmote = (seat: number, emoji: string) => (liveOnline ? online.emitEmote(seat, emoji) : setLocalEmote({ seat, emoji, key: Date.now() + Math.random() }))
  const showEmoteRef = useRef(showEmote)
  showEmoteRef.current = showEmote
  useEffect(() => {
    const prev = emoteRef.current.prev
    emoteRef.current.prev = botGame
    if (!botGame || !prev || prev.options.seed !== botGame.options.seed || fingerprint(prev) === fingerprint(botGame)) return
    if (Date.now() - emoteRef.current.at < 3500) return
    const r = botReaction(prev, botGame, Math.random)
    if (!r) return
    emoteRef.current.at = Date.now()
    // not cancelled when the game moves on: the reaction belongs to the moment that triggered it
    setTimeout(() => showEmoteRef.current(r.seat, r.emoji), 500 + Math.random() * 700)
  }, [botGame])
  const shownEmote = liveOnline ? online.emote : localEmote
  const replied = useRef(0)
  useEffect(() => {
    if (!shownEmote || !botGame || replied.current === shownEmote.key || !botGame.players[shownEmote.seat]?.human) return
    replied.current = shownEmote.key
    const r = botReply(shownEmote.emoji, botGame, Math.random)
    if (!r) return
    setTimeout(() => showEmoteRef.current(r.seat, r.emoji), 700 + Math.random() * 900)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownEmote])
  const sendMyEmote = (emoji: string) => (liveOnline ? online.sendEmote(emoji) : setLocalEmote({ seat: ME, emoji, key: Date.now() + Math.random() }))

  const playLocal = (action: Action) => {
    tap(action.type === 'take' ? 'medium' : 'light')
    setGame((g) => {
      if (!g) return g
      try {
        return applyAction(g, ME, action)
      } catch {
        return g
      }
    })
  }
  const playOnline = (action: Action) => {
    tap(action.type === 'take' ? 'medium' : 'light')
    online.act(action)
  }

  // Joining from a friend's invitation: the server (if the invite names one) is applied first, then the join runs after the render that uses it.
  const [pendingJoin, setPendingJoin] = useState<string | null>(null)
  const [pendingInvite, setPendingInvite] = useState<string | null>(null)
  const joinFromInvite = (code: string, server?: string) => {
    if (server && server !== settings.server) setSettings((s) => ({ ...s, server }))
    online.leave()
    setPanel(null)
    setScreen('online')
    setPendingJoin(code)
  }
  useEffect(() => {
    if (!pendingJoin) return
    online.join(pendingJoin, settings.name.trim() || 'Игрок')
    setPendingJoin(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJoin])
  const inviteFriend = (id: string) => {
    const hosting = online.role === 'host' && online.lobby
    if (hosting) {
      friends.invite(id, online.lobby!.code, settings.server).then((ok) => friends.say(ok ? 'Приглашение отправлено' : 'Друг сейчас не в сети. Отправьте ему код комнаты'))
      return
    }
    if (online.phase !== 'idle' || screen === 'game') return friends.say('Сначала выйдите из текущей игры')
    setPendingInvite(id)
    setPanel(null)
    setScreen('online')
    online.create({ name: settings.name.trim() || 'Игрок', mode: settings.mode, deckSize: settings.deckSize, cheat: settings.cheat })
  }
  useEffect(() => {
    if (!pendingInvite || online.role !== 'host' || !online.lobby) return
    const id = pendingInvite
    setPendingInvite(null)
    friends.invite(id, online.lobby.code, settings.server).then((ok) => friends.say(ok ? 'Приглашение отправлено' : 'Друг сейчас не в сети. Отправьте ему код комнаты'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvite, online.lobby])

  const newRound = (s: Settings = settings, fresh = true) => {
    const g = startGame(s)
    setGame(g)
    setSeries((cur) => (s.series > 1 ? (fresh || !cur || cur.played >= cur.total ? { total: s.series, played: 0, fools: g.players.map(() => 0) } : cur) : null))
    setScreen('game')
  }

  const canContinue = !!game && !game.over && (game.discard.length > 0 || game.table.length > 0 || game.lastAction !== null)
  const onlineGame = screen === 'online' && online.phase === 'playing' && online.game

  const panels = (
    <AnimatePresence>
      {panel === 'settings' && (
        <SettingsPanel
          key="settings"
          settings={settings}
          inGame={screen === 'game'}
          onClose={() => setPanel(null)}
          onChange={setSettings}
          onStart={(s) => {
            setSettings(s)
            setPanel(null)
            if (onlineGame) online.leave()
            newRound(s)
          }}
        />
      )}
      {panel === 'friends' && <FriendsPanel key="friends" friends={friends} onInvite={inviteFriend} onClose={() => setPanel(null)} />}
      {panel === 'rules' && <RulesPanel key="rules" onClose={() => setPanel(null)} />}
      {panel === 'stats' && (
        <StatsPanel
          key="stats"
          stats={stats}
          settings={settings}
          onSettings={setSettings}
          onClose={() => setPanel(null)}
          onReset={() => {
            saveStats(EMPTY_STATS)
            setStats(EMPTY_STATS)
          }}
        />
      )}
    </AnimatePresence>
  )

  let view
  if (onlineGame) {
    const host = online.role === 'host'
    view = (
      <GameScreen
        key={`online-${online.lobby?.code ?? ''}`}
        game={onlineGame}
        me={online.seat}
        act={playOnline}
        stats={stats}
        paused={false}
        botDelay={BOT_DELAY[settings.speed]}
        onBotTurn={host ? stepOnlineBot : undefined}
        emote={online.emote}
        onEmote={online.sendEmote}
        friends={friends}
        onFinished={recordResult}
        onExit={() => online.leave()}
        onOpenSettings={() => setPanel('settings')}
        onPlayAgain={host ? () => online.start(settings.difficulty) : undefined}
        room={{ code: online.lobby?.code ?? '', notice: online.notice, reconnecting: online.reconnecting, roster: online.lobby?.roster }}
      />
    )
  } else if (screen === 'game' && game) {
    view = (
      <GameScreen
        key="local"
        game={game}
        me={ME}
        act={playLocal}
        stats={stats}
        paused={panel !== null}
        botDelay={BOT_DELAY[settings.speed]}
        onBotTurn={stepLocalBot}
        onFinished={recordResult}
        onExit={() => setScreen('menu')}
        onOpenSettings={() => setPanel('settings')}
        series={series}
        emote={shownEmote}
        onEmote={sendMyEmote}
        onPlayAgain={() => newRound(settings, false)}
      />
    )
  } else if (screen === 'online') {
    view = (
      <OnlineScreen
        key="online"
        online={online}
        settings={settings}
        onChange={setSettings}
        initialCode={inviteCode}
        friends={friends}
        onInviteFriend={inviteFriend}
        onBack={() => {
          online.leave()
          setScreen(inviteCode ? 'menu' : 'play')
        }}
      />
    )
  } else if (screen === 'play') {
    view = <PlayScreen key="play" settings={settings} onChange={setSettings} onBots={() => newRound()} onOnline={() => setScreen('online')} onBack={() => setScreen('menu')} />
  } else {
    view = <MainMenu key="menu" settings={settings} stats={stats} canContinue={canContinue} onContinue={() => setScreen('game')} onPlay={() => setScreen('play')} onOpen={setPanel} friendCount={friends.list.length} />
  }

  return (
    <>
      <AnimatePresence mode="wait">{view}</AnimatePresence>
      {panels}
      <UpdateToast state={update} />
      <FriendToast friends={friends} busy={inRound} onJoin={joinFromInvite} />
    </>
  )
}
