import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { eagerThrow } from '../engine/bot'
import { think } from '../engine/think'
import { botReaction, botReply, type Emote, fingerprint } from '../engine/emotes'
import { Action, applyAction, currentActor, gameIdOf, GameState, isValidGame, maxPlayers, newGame } from '../engine/game'
import { setRoomServer } from '../net/room'
import { inBrowserTab, inviteFromText, type Invite, iosHomeScreen, parseInvite, watchInvites } from './deeplink'
import { useFriends } from '../net/useFriends'
import { hasSavedRoom, type RoomEnd, TURN_MS, useOnline } from '../net/useOnline'
import { type ConfirmAsk, ConfirmSheet } from './Confirm'
import { GameScreen, Result, Series } from './GameScreen'
import { FriendToast } from './FriendToast'
import { FriendsPanel } from './FriendsPanel'
import { RulesPanel, StatsPanel } from './InfoPanels'
import { MainMenu } from './MainMenu'
import { setHaptics, syncStatusBar, tap } from './native'
import { OnlineScreen } from './OnlineScreen'
import { BOT_NAMES, plural } from './pickers'
import { BotSetupSheet } from './PlayScreen'
import { useBack, useSystemBack } from './back'
import { Capacitor } from '@capacitor/core'
import { GameMenu, SettingsPanel } from './SettingsPanel'
import { addResult, applyLook, applyTheme, BOT_DELAY, deviceToken, EMPTY_STATS, loadSettings, loadStats, saveSettings, saveStats, Settings, Stats } from './settings'
import { setSoundEnabled, unlockSound } from './sfx'
import { UpdateToast } from './UpdateToast'
import { applyTextScale } from './textScale'
import { affordableStake, bonusReady, cancelWager, forfeitRoom, isBroke, LEVEL_BONUS, loadWallet, placeWager, PayoutInfo, refill, refundRoom, saveWallet, settle, takeBonus, Wallet } from './wallet'
import { applyIfIdle, startUpdates, UpdateState } from './updates'

const ME = 0
type Screen = 'menu' | 'online' | 'game'
type Panel = 'settings' | 'game' | 'rules' | 'stats' | 'friends' | 'setup'

// The bot game is saved as it goes, so closing or reloading the app never loses a hand.
const GAME_KEY = 'durak.game'
function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(GAME_KEY)
    const g: unknown = raw ? JSON.parse(raw) : null
    return isValidGame(g) && !g.over ? g : null
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

const playersFor = (s: Settings) => Math.min(s.opponents + 1, maxPlayers(s.deckSize))

function startGame(s: Settings, stake: number): GameState {
  return newGame({ players: playersFor(s), deckSize: s.deckSize, mode: s.mode, cheat: s.cheat, firstBeatFive: s.firstFive, names: ['Вы', ...BOT_NAMES], human: ME, level: s.difficulty, stake })
}


/** A room code from an invite link like …/durak/#join-AB3CD, plus the private server a link may carry (&s=…). */
function inviteFromUrl(): Invite {
  return parseInvite(window.location.href) ?? { code: '', server: '' }
}

export function App() {
  const [invite, setInvite] = useState(inviteFromUrl)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  // A server named by an invite is used for that room only: a link must never re-point the app for good.
  const [joinServer, setJoinServer] = useState(invite.server)
  const roomServer = joinServer || settings.server
  setRoomServer(roomServer)
  const [stats, setStats] = useState<Stats>(loadStats)
  const [wallet, setWallet] = useState<Wallet>(loadWallet)
  const [payout, setPayout] = useState<PayoutInfo | null>(null)
  useEffect(() => saveWallet(wallet), [wallet])
  const [game, setGame] = useState<GameState | null>(loadGame)
  const [series, setSeries] = useState<Series | null>(null)
  const [localEmote, setLocalEmote] = useState<Emote | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  // Rules opened from the pause menu go back to it when closed.
  const [rulesFrom, setRulesFrom] = useState<Panel | null>(null)
  const inviteCode = invite.code
  const [resumeRoom] = useState(() => !inviteCode && hasSavedRoom())
  const [screen, setScreen] = useState<Screen>(inviteCode || resumeRoom ? 'online' : 'menu')
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })
  const [token] = useState(deviceToken)
  const friends = useFriends(settings.name, settings.server)
  // A room game that ends before its last card settles the stake right away: leaving on purpose loses it,
  // being cut off (the host closed the room, the line was lost) gives it back.
  const [refund, setRefund] = useState<number | null>(null)
  const roomGame = useRef<GameState | null>(null)
  const onRoomEnd = useCallback((why: RoomEnd) => {
    const g = roomGame.current
    if (!g) return
    const seed = gameIdOf(g)
    setWallet((w) => {
      if (why === 'left') return forfeitRoom(w, seed)
      const r = refundRoom(w, seed)
      if (r.back) setRefund(r.back)
      return r.wallet
    })
  }, [])
  const online = useOnline(token, friends.fid, onRoomEnd)
  roomGame.current = online.game
  useEffect(() => {
    if (online.phase !== 'error') setRefund(null)
  }, [online.phase])
  const [ask, setAsk] = useState<ConfirmAsk | null>(null)
  /** The host leaving a room with friends in it closes it for them too: asked once, first. */
  const confirmClose = (run: () => void, what = 'Закрыть комнату?') => {
    if (online.role === 'host' && online.others > 0) setAsk({ title: what, text: `${plural(online.others, 'Друг', 'Друзья', 'Друзья')} (${online.others}) ${online.others === 1 ? 'выйдет' : 'выйдут'} из неё.`, yes: 'Закрыть', no: 'Остаться', run })
    else run()
  }

  useEffect(() => {
    applyTheme(settings.theme)
    syncStatusBar()
  }, [settings.theme])
  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => applyLook(settings.cardBack, settings.tableStyle, settings.cardFace), [settings.cardBack, settings.tableStyle, settings.cardFace])
  useEffect(() => setHaptics(settings.haptics), [settings.haptics])
  useEffect(() => {
    applyTextScale(settings.big)
    // the phone's text size can change while the app sits in the background
    const again = () => document.visibilityState === 'visible' && applyTextScale(settings.big)
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [settings.big])
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
  // Out of the online screen, an invite's own server is forgotten.
  useEffect(() => {
    if (screen !== 'online' && online.phase === 'idle' && joinServer) setJoinServer('')
  }, [screen, online.phase, joinServer])
  useEffect(() => {
    if (resumeRoom) online.restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (inviteCode && window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [inviteCode])
  // A link that reaches the app while it is already open (or launches the native app) lands in the same join screen.
  const inviteWatch = useRef<(inv: Invite) => void>(() => {})
  inviteWatch.current = (inv) => {
    if (inv.code === invite.code && screen === 'online') return
    if (busyRef.current) {
      friends.say(`Приглашение в комнату ${inv.code}: доиграйте партию и войдите по коду`)
      return
    }
    const go = () => {
      setJoinServer(inv.server)
      online.leave()
      setPanel(null)
      setInvite(inv)
      setScreen('online')
    }
    if (online.role === 'host' && online.others > 0) setAsk({ title: `Перейти в комнату ${inv.code}?`, text: 'Ваша комната закроется, и друзья выйдут из неё.', yes: 'Перейти', no: 'Остаться', run: go })
    else go()
  }
  useEffect(() => watchInvites((inv) => inviteWatch.current(inv)), [])

  // Callbacks handed to the table stay stable, so a re-render doesn't restart its bot timer.
  const onlineRef = useRef(online)
  onlineRef.current = online
  const stepOnlineBot = useCallback((actor: number) => onlineRef.current.stepBot(actor), [])
  const throwOnlineBot = useCallback(() => onlineRef.current.botThrow(), [])
  const throwLocalBot = useCallback(
    () =>
      setGame((g) => {
        const t = g && eagerThrow(g)
        return t ? applyAction(g, t.player, t.action) : g
      }),
    [],
  )
  const gameNow = useRef(game)
  gameNow.current = game
  const stepLocalBot = useCallback((actor: number) => {
    const g = gameNow.current
    if (!g || currentActor(g) !== actor) return
    // The move is worked out off the main thread; if the table changed meanwhile it is dropped and asked for again.
    think(g, actor).then((action) =>
      setGame((cur) => {
        if (cur !== g) return cur
        try {
          return applyAction(cur, actor, action)
        } catch {
          return cur
        }
      }),
    )
  }, [])
  // The finished game's setup goes into the history, so keep the live game in a ref.
  const liveRef = useRef<{ game: GameState | null; online: boolean }>({ game: null, online: false })
  const liveOnline = screen === 'online' && online.phase === 'playing' && online.game
  liveRef.current = { game: liveOnline || (screen === 'game' ? game : null), online: !!liveOnline }
  // A room game takes this device's own stake when it starts; each player keeps their own wallet.
  const roomSeed = liveOnline && !liveOnline.over ? gameIdOf(liveOnline) : undefined
  useEffect(() => {
    const g = liveRef.current.game
    if (roomSeed === undefined || !g || !liveRef.current.online) return
    setWallet((w) => {
      if (w.roomWager?.seed === roomSeed) return w
      const stake = affordableStake(w, g.options.stake ?? 0, g.players.length)
      return placeWager(w, roomSeed, stake, g.players.length, 1, 'roomWager')
    })
  }, [roomSeed])
  const recordResult = useCallback((result: Result, loser: number | null) => {
    const g = liveRef.current.game
    if (!liveRef.current.online)
      setSeries((cur) => (cur && cur.played < cur.total ? { ...cur, played: cur.played + 1, fools: cur.fools.map((n, i) => (i === loser ? n + 1 : n)) } : cur))
    const seed = g ? gameIdOf(g) : undefined
    if (seed !== undefined) {
      const slot = liveRef.current.online ? 'roomWager' : 'wager'
      setWallet((w) => {
        const r = settle(w, seed, result, slot)
        if (!r) return w
        setPayout({ seed, delta: r.delta, balance: r.wallet.balance })
        return r.wallet
      })
    }
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
    if (!botGame || !prev || gameIdOf(prev) !== gameIdOf(botGame) || fingerprint(prev) === fingerprint(botGame)) return
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
    const go = () => {
      setJoinServer(server ?? '')
      online.leave()
      setPanel(null)
      setScreen('online')
      setPendingJoin(code)
    }
    if (online.role === 'host' && online.others > 0) setAsk({ title: `Перейти в комнату ${code}?`, text: 'Ваша комната закроется, и друзья выйдут из неё.', yes: 'Перейти', no: 'Остаться', run: go })
    else go()
  }
  useEffect(() => {
    if (!pendingJoin) return
    online.join(pendingJoin, settings.name.trim() || 'Игрок')
    setPendingJoin(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJoin])
  // iPhone never hands a link to a site on the home screen, so the invite comes over through the clipboard.
  const pasteInvite = async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      friends.say('Не удалось прочитать буфер. Войдите по коду: Играть → С друзьями')
      return
    }
    const inv = inviteFromText(text)
    if (!inv) {
      friends.say('В буфере нет приглашения. Скопируйте ссылку в Telegram и нажмите ещё раз')
      return
    }
    joinFromInvite(inv.code, inv.server)
  }
  const inviteFriend = (id: string) => {
    const hosting = online.role === 'host' && online.lobby
    if (hosting) {
      friends.invite(id, online.lobby!.code, roomServer).then((ok) => friends.say(ok ? 'Приглашение отправлено' : 'Друг сейчас не в сети. Отправьте ему код комнаты'))
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
    friends.invite(id, online.lobby.code, roomServer).then((ok) => friends.say(ok ? 'Приглашение отправлено' : 'Друг сейчас не в сети. Отправьте ему код комнаты'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvite, online.lobby])

  const newRound = (s: Settings = settings, fresh = true) => {
    // The chosen stake, or less if the balance no longer covers it.
    const stake = affordableStake(wallet, s.stake, playersFor(s))
    if (stake !== s.stake) setSettings((cur) => ({ ...cur, stake }))
    const g = startGame(s, stake)
    // a game nobody has moved in yet gives its stake back; one under way loses it
    const untouched = game && !game.over && !started ? gameIdOf(game) : undefined
    setWallet((w) => placeWager(untouched !== undefined ? cancelWager(w, untouched) : w, gameIdOf(g), stake, g.players.length, LEVEL_BONUS[s.difficulty]))
    setGame(g)
    setSeries((cur) => (s.series > 1 ? (fresh || !cur || cur.played >= cur.total ? { total: s.series, played: 0, fools: g.players.map(() => 0) } : cur) : null))
    setPanel(null)
    setScreen('game')
  }

  // Any unfinished game can be gone back to, even one only just dealt.
  const canContinue = !!game && !game.over
  const started = !!game && !game.over && (game.discard.length > 0 || game.table.length > 0 || game.lastAction !== null)
  const pendingStake = started && game && wallet.wager?.seed === gameIdOf(game) ? wallet.wager.held : 0
  const onlineGame = screen === 'online' && online.phase === 'playing' && online.game

  const panels = (
    <AnimatePresence>
      {panel === 'settings' && <SettingsPanel key="settings" settings={settings} onClose={() => setPanel(null)} onChange={setSettings} />}
      {panel === 'game' && (onlineGame || screen === 'game') && (
        <GameMenu
          key="game-menu"
          settings={settings}
          onChange={setSettings}
          onClose={() => setPanel(null)}
          onRules={() => {
            setRulesFrom('game')
            setPanel('rules')
          }}
          onExit={() => (onlineGame ? online.leave() : setScreen('menu'))}
          online={!!onlineGame}
          botSpeed={onlineGame ? online.role === 'host' && onlineGame.players.some((p) => !p.human) : true}
        />
      )}
      {panel === 'friends' && <FriendsPanel
          key="friends"
          friends={friends}
          onInvite={inviteFriend}
          onPlayOnline={() => {
            setPanel(null)
            setScreen('online')
          }}
          onClose={() => setPanel(null)}
        />}
      {panel === 'rules' && (
        <RulesPanel
          key="rules"
          onClose={() => {
            setPanel(rulesFrom && (onlineGame || screen === 'game') ? rulesFrom : null)
            setRulesFrom(null)
          }}
        />
      )}
      {panel === 'setup' && <BotSetupSheet key="setup" settings={settings} wallet={wallet} pendingStake={pendingStake} onChange={setSettings} onStart={() => newRound()} onClose={() => setPanel(null)} />}
      {ask && <ConfirmSheet key="confirm" ask={ask} onClose={() => setAsk(null)} />}
      {panel === 'stats' && (
        <StatsPanel
          key="stats"
          stats={stats}
          wallet={wallet}
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

  // System back: at the table it opens the menu (and closes it again); sheets and the online screen take their own steps first.
  useBack(() => {
    if (!(onlineGame || (screen === 'game' && game))) return false
    setPanel((p) => (p === 'game' ? null : 'game'))
    return true
  })
  useSystemBack(screen === 'menu' && panel === null, () => friends.say('Нажмите ещё раз, чтобы выйти'), (Capacitor.getPlatform() === 'ios' || iosHomeScreen()) && !inRound)

  let view
  if (onlineGame) {
    const host = online.role === 'host'
    view = (
      <GameScreen
        key={`online-${online.lobby?.code ?? ''}`}
        game={onlineGame}
        me={online.seat}
        act={playOnline}
        paused={false}
        botDelay={BOT_DELAY[settings.speed]}
        onBotTurn={host ? stepOnlineBot : undefined}
        onBotThrow={host ? throwOnlineBot : undefined}
        emote={online.emote}
        onEmote={online.sendEmote}
        friends={friends}
        onFinished={recordResult}
        wager={wallet.roomWager?.seed === gameIdOf(onlineGame) ? wallet.roomWager : null}
        payout={payout?.seed === gameIdOf(onlineGame) ? payout : null}
        onExit={() => confirmClose(() => online.leave())}
        onOpenSettings={() => setPanel('game')}
        onPlayAgain={host ? () => online.start(settings.difficulty) : undefined}
        onToLobby={host ? () => online.toLobby() : undefined}
        room={{
          code: online.lobby?.code ?? '',
          notice: online.notice,
          reconnecting: online.reconnecting,
          roster: online.lobby?.roster,
          turnMs: TURN_MS,
          link: { guest: !host, reconnecting: online.reconnecting, lostAt: online.lostAt, hostAway: online.hostAway, hostName: online.lobby?.members.find((m) => m.host)?.name, onLeave: () => online.leave() },
        }}
      />
    )
  } else if (screen === 'game' && game) {
    view = (
      <GameScreen
        key="local"
        game={game}
        me={ME}
        act={playLocal}
        paused={panel !== null}
        botDelay={BOT_DELAY[settings.speed]}
        onBotTurn={stepLocalBot}
        onBotThrow={throwLocalBot}
        onFinished={recordResult}
        wager={wallet.wager?.seed === gameIdOf(game) ? wallet.wager : null}
        payout={payout?.seed === gameIdOf(game) ? payout : null}
        onExit={() => setScreen('menu')}
        onOpenSettings={() => setPanel('game')}
        series={series}
        coach={stats.wins + stats.losses + stats.draws < 3}
        emote={shownEmote}
        onEmote={sendMyEmote}
        onPlayAgain={() => newRound(settings, false)}
      />
    )
  } else if (screen === 'online') {
    view = (
      <OnlineScreen
        key={`online-${inviteCode}`}
        online={online}
        settings={settings}
        wallet={wallet}
        onChange={setSettings}
        server={roomServer}
        onInviteServer={setJoinServer}
        initialCode={inviteCode}
        offerApp={!!inviteCode && !invite.noApp && inBrowserTab()}
        friends={friends}
        onInviteFriend={inviteFriend}
        refund={refund}
        onBack={() => {
          online.leave()
          setScreen('menu')
          setInvite({ code: '', server: '' })
        }}
      />
    )
  } else {
    view = (
      <MainMenu
        key="menu"
        onPasteInvite={iosHomeScreen() ? pasteInvite : undefined}
        settings={settings}
        wallet={wallet}
        bonus={bonusReady(wallet)}
        broke={isBroke(wallet)}
        onBonus={() => setWallet(takeBonus)}
        onRefill={() => setWallet(refill)}
        canContinue={canContinue}
        onContinue={() => setScreen('game')}
        onSetup={() => setPanel('setup')}
        onQuick={() => newRound()}
        onFriendsGame={() => setScreen('online')}
        onOpen={setPanel}
        friendCount={friends.list.length}
      />
    )
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
