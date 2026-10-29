import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseAction } from '../engine/bot'
import { Action, applyAction, currentActor, GameState, maxPlayers, newGame } from '../engine/game'
import { normalizeCode } from '../net/room'
import { hasSavedRoom, useOnline } from '../net/useOnline'
import { GameScreen, Result } from './GameScreen'
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
type Panel = 'settings' | 'rules' | 'stats'

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
  return newGame({ players, deckSize: s.deckSize, mode: s.mode, cheat: s.cheat, names: ['Вы', ...BOT_NAMES], human: ME, seed: Date.now() })
}

/** A room code from an invite link like …/durak/#join-AB3CD. */
function codeFromHash(): string {
  const m = /^#join-([A-Za-z0-9]+)/.exec(window.location.hash)
  return m ? normalizeCode(m[1]) : ''
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [stats, setStats] = useState<Stats>(loadStats)
  const [game, setGame] = useState<GameState | null>(loadGame)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [inviteCode] = useState(codeFromHash)
  const [resumeRoom] = useState(() => !inviteCode && hasSavedRoom())
  const [screen, setScreen] = useState<Screen>(inviteCode || resumeRoom ? 'online' : 'menu')
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })
  const [token] = useState(deviceToken)
  const online = useOnline(token)

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
  const levelRef = useRef(settings.difficulty)
  levelRef.current = settings.difficulty
  const stepOnlineBot = useCallback((actor: number) => onlineRef.current.stepBot(actor, levelRef.current), [])
  const stepLocalBot = useCallback((actor: number) => setGame((g) => (g && currentActor(g) === actor ? applyAction(g, actor, chooseAction(g, actor, levelRef.current)) : g)), [])
  // The finished game's setup goes into the history, so keep the live game in a ref.
  const liveRef = useRef<{ game: GameState | null; online: boolean }>({ game: null, online: false })
  const liveOnline = screen === 'online' && online.phase === 'playing' && online.game
  liveRef.current = { game: liveOnline || (screen === 'game' ? game : null), online: !!liveOnline }
  const recordResult = useCallback((result: Result) => {
    const g = liveRef.current.game
    setStats((s) => {
      const next = addResult(s, { at: Date.now(), result, mode: g?.options.mode ?? 'podkidnoy', deck: g?.options.deckSize ?? 36, players: g?.players.length ?? 2, online: liveRef.current.online })
      saveStats(next)
      return next
    })
  }, [])

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

  const newRound = (s: Settings = settings) => {
    setGame(startGame(s))
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
        onFinished={recordResult}
        onExit={() => online.leave()}
        onOpenSettings={() => setPanel('settings')}
        onPlayAgain={host ? () => online.start() : undefined}
        room={{ code: online.lobby?.code ?? '', notice: online.notice, reconnecting: online.reconnecting }}
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
        onPlayAgain={() => newRound()}
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
        onBack={() => {
          online.leave()
          setScreen(inviteCode ? 'menu' : 'play')
        }}
      />
    )
  } else if (screen === 'play') {
    view = <PlayScreen key="play" settings={settings} onChange={setSettings} onBots={() => newRound()} onOnline={() => setScreen('online')} onBack={() => setScreen('menu')} />
  } else {
    view = <MainMenu key="menu" settings={settings} stats={stats} canContinue={canContinue} onContinue={() => setScreen('game')} onPlay={() => setScreen('play')} onOpen={setPanel} />
  }

  return (
    <>
      <AnimatePresence mode="wait">{view}</AnimatePresence>
      {panels}
      <UpdateToast state={update} />
    </>
  )
}
