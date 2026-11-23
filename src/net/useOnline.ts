import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckSize } from '../engine/cards'
import { eagerThrow, type Level } from '../engine/bot'
import { think } from '../engine/think'
import { EMOTES, type Emote } from '../engine/emotes'
import { Action, applyAction, currentActor, GameState, isValidGame, maxPlayers, Mode, newGame, timeoutAction, viewFor } from '../engine/game'
import { BOT_NAMES } from '../ui/pickers'
import { type ErrorKind, GuestRoom, HostRoom, type JoinStage, LobbyInfo, Member, memberId, publicLobby, type RoomError, type RoomPreview, ToGuest } from './room'

export type OnlinePhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'error'

/** How a room game in progress ended for this device: left on purpose, or cut off through no fault of its own. */
export type RoomEnd = 'left' | 'interrupted'

export interface Online {
  phase: OnlinePhase
  role: 'host' | 'guest' | null
  error: RoomError | null
  /** the room code being joined or hosted, kept for the error screen and «Повторить» */
  code: string
  /** guest: the step of getting in, while connecting */
  stage: JoinStage | null
  /** guest: getting in is taking longer than usual */
  slow: boolean
  /** guest: when the line to the host dropped (0 while it is up), for a countdown */
  lostAt: number
  /** guest: the host put the app in the background */
  hostAway: boolean
  /** other people in the room (not bots, not this device), online or not */
  others: number
  lobby: LobbyInfo | null
  game: GameState | null
  seat: number
  notice: string | null
  /** the connection dropped (e.g. the app was in the background) and is coming back */
  reconnecting: boolean
  create: (opts: { name: string; mode: Mode; deckSize: DeckSize; cheat?: boolean }) => void
  join: (code: string, name: string) => void
  leave: () => void
  /** tries the same room again after an error */
  retry: () => void
  start: (level?: Level) => void
  /** host only: back from a finished game to the room, to change the setup */
  toLobby: () => void
  /** false when the move could not go out (the line is down) */
  act: (action: Action) => boolean
  setLobby: (patch: Partial<Pick<LobbyInfo, 'bots' | 'mode' | 'deckSize' | 'cheat' | 'stake'>>) => void
  /** host only: removes the member with this lobby id */
  kick: (id: string) => void
  /** host only: let the bot in `actor`'s seat make its move */
  stepBot: (actor: number, level?: Level) => void
  /** host only: a bot throws in while the defender is still covering, if one wants to */
  botThrow: () => void
  restore: () => boolean
  /** the latest emote at the table, from anyone */
  emote: Emote | null
  /** this player's own emote */
  sendEmote: (emoji: string) => void
  /** host only: an emote from a bot's seat */
  emitEmote: (seat: number, emoji: string) => void
}

/** Saved so a room survives the app being reloaded or killed while a player is away sharing the invite. */
interface Saved {
  role: 'host' | 'guest'
  code: string
  name: string
  savedAt: number
  lobby?: LobbyInfo
  game?: GameState | null
  seats?: [string, number][]
}

/** How long a person in a room has for a move before the host plays it for them. */
export const TURN_MS = 30_000
/** Missed turns in a row after which a bot takes the seat until its player moves again. */
const STRIKES_TO_BOT = 2

const SAVE_KEY = 'durak.online'
const SAVE_TTL_MS = 20 * 60 * 1000

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    const saved = raw ? (JSON.parse(raw) as Saved) : null
    if (!saved || typeof saved !== 'object' || (saved.role !== 'host' && saved.role !== 'guest') || typeof saved.code !== 'string' || typeof saved.name !== 'string') return null
    if (!(Date.now() - saved.savedAt < SAVE_TTL_MS)) return null
    // a damaged or outdated table is dropped; the room itself can still be reopened
    if (saved.game && !isValidGame(saved.game)) saved.game = null
    if (saved.lobby && !Array.isArray(saved.lobby.members)) return null
    return saved
  } catch {
    return null
  }
}

function writeSaved(saved: Saved | null) {
  try {
    if (saved) localStorage.setItem(SAVE_KEY, JSON.stringify(saved))
    else localStorage.removeItem(SAVE_KEY)
  } catch {
    /* storage unavailable: a reload just ends the room */
  }
}

/** Whether a room from before a reload can be picked up again. */
export const hasSavedRoom = () => loadSaved() !== null

/** Keeps the bot count within what the deck can seat. */
function fitBots(lobby: LobbyInfo): LobbyInfo {
  const room = maxPlayers(lobby.deckSize) - lobby.members.length
  return { ...lobby, bots: Math.max(0, Math.min(lobby.bots, room)) }
}

/** A guest's error from the host's own words, for hosts that do not say which kind it is. */
function kindOf(reason: string): ErrorKind {
  if (/закрыл/i.test(reason)) return 'closed'
  if (/убрал/i.test(reason)) return 'kicked'
  if (/заполнена/i.test(reason)) return 'full'
  if (/этом же устройстве|ваша же/i.test(reason)) return 'same-device'
  return 'other'
}

export function useOnline(token: string, fid: string, onEnd?: (why: RoomEnd) => void): Online {
  const [phase, setPhase] = useState<OnlinePhase>('idle')
  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [error, setError] = useState<RoomError | null>(null)
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<JoinStage | null>(null)
  const [slow, setSlow] = useState(false)
  const [lostAt, setLostAt] = useState(0)
  const [hostAway, setHostAway] = useState(false)
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  /** a game is on for this device: leaving or losing the room now decides the stake */
  const midGame = () => {
    const g = gameRef.current
    return !!g && !g.over && phaseRef.current === 'playing'
  }
  const phaseRef = useRef<OnlinePhase>('idle')
  phaseRef.current = phase
  const lastCreate = useRef<{ name: string; mode: Mode; deckSize: DeckSize; cheat?: boolean } | null>(null)
  const [lobby, setLobbyState] = useState<LobbyInfo | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [seat, setSeat] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [emote, setEmote] = useState<Emote | null>(null)
  const gameRef = useRef<GameState | null>(null)
  gameRef.current = game
  const nameRef = useRef('')

  const host = useRef<HostRoom | null>(null)
  const guest = useRef<GuestRoom | null>(null)
  const lobbyRef = useRef<LobbyInfo | null>(null)
  const seats = useRef(new Map<string, number>())

  const say = (text: string) => {
    setNotice(text)
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 2500)
  }

  const updateLobby = useCallback((fn: (l: LobbyInfo) => LobbyInfo) => {
    setLobbyState((prev) => {
      if (!prev) return prev
      const raw = fn(prev)
      const base = fitBots(raw)
      // A bot that has to make room for a person says so, instead of vanishing.
      const newcomer = raw.members.length > prev.members.length ? raw.members[raw.members.length - 1] : null
      if (newcomer && base.bots < raw.bots && BOT_NAMES[base.bots]) base.note = { key: Date.now(), text: `${BOT_NAMES[base.bots]} уступил место: ${newcomer.name}` }
      const g = gameRef.current
      base.playing = !!g && !g.over
      const roster = base.members
        .filter((m) => m.token && seats.current.has(m.token))
        .map((m) => ({ seat: seats.current.get(m.token!)!, name: m.name, fid: m.fid, ...(m.online ? {} : { off: true }), ...(m.away && m.online ? { away: true } : {}) }))
      const next = roster.length ? { ...base, roster } : { ...base, roster: undefined }
      lobbyRef.current = next
      host.current?.broadcast({ t: 'lobby', lobby: publicLobby(next) })
      return next
    })
  }, [])

  // The host is the single source of truth: every change goes out as a per-seat view.
  useEffect(() => {
    if (role !== 'host' || !game || !host.current) return
    for (const [t, s] of seats.current) if (t !== token) host.current.send(t, { t: 'state', view: viewFor(game, s), seat: s })
  }, [game, role, token])

  // Late joiners waiting in the room see when the game they wait for is over.
  const over = role === 'host' && !!game?.over
  useEffect(() => {
    if (over) updateLobby((cur) => cur)
  }, [over, updateLobby])

  // Nobody holds the table up: a person who lets the clock run out gets the safe move played for them,
  // and after a couple of those a bot keeps the seat warm until they come back.
  const strikes = useRef(new Map<number, number>())
  useEffect(() => {
    if (role !== 'host' || !game || game.over) return
    const actor = currentActor(game)
    if (actor === null || !game.players[actor].human) return
    const t = setTimeout(() => {
      const g = gameRef.current
      if (g !== game) return
      const action = timeoutAction(g, actor)
      if (!action) return
      let next: GameState
      try {
        next = applyAction(g, actor, action)
      } catch {
        return
      }
      const missed = (strikes.current.get(actor) ?? 0) + 1
      strikes.current.set(actor, missed)
      if (missed >= STRIKES_TO_BOT && !next.over) {
        next = structuredClone(next)
        next.players[actor].human = false
        say(`${next.players[actor].name} не отвечает, за него играет бот`)
      }
      gameRef.current = next
      setGame(next)
    }, TURN_MS)
    return () => clearTimeout(t)
  }, [game, role])

  /** A person's own move: they are here, so the seat is theirs again. */
  const own = (g: GameState, s: number): GameState => {
    strikes.current.delete(s)
    if (g.players[s].human) return g
    const next = structuredClone(g)
    next.players[s].human = true
    return next
  }

  // Remember the room on every change, so it can be reopened after a reload.
  useEffect(() => {
    if (!role || !lobby) return
    writeSaved({
      role,
      code: lobby.code,
      name: nameRef.current,
      savedAt: Date.now(),
      ...(role === 'host' ? { lobby, game, seats: [...seats.current] } : {}),
    })
  }, [role, lobby, game])

  // Coming back from another app: check the line and restore it if it dropped.
  useEffect(() => {
    const onVisible = () => {
      // The others hear at once that this player put the app away, before the line itself goes quiet.
      const hidden = document.visibilityState === 'hidden'
      host.current?.away(hidden)
      guest.current?.away(hidden)
      if (hidden) return
      host.current?.resume()
      guest.current?.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])

  const openHost = (name: string, restore: Saved | null, fresh?: { mode: Mode; deckSize: DeckSize; cheat?: boolean }) => {
    nameRef.current = name
    setRole('host')
    setPhase('connecting')
    setError(null)
    setCode(restore?.code ?? '')
    seats.current = new Map(restore?.seats ?? [])
    if (restore?.game) {
      // Friends count as away until they reconnect; bots keep their seats warm meanwhile.
      const g = structuredClone(restore.game)
      for (const [t, s] of seats.current) if (t !== token && g.players[s]) g.players[s].human = false
      setGame(g)
    }
    host.current = new HostRoom({
      onReady: (code) => {
        setCode(code)
        const l: LobbyInfo = restore?.lobby
          ? { ...restore.lobby, members: restore.lobby.members.map((m) => ({ ...m, id: m.id ?? memberId(), online: m.token === token, fid: m.token === token ? fid : m.fid })) }
          : { code, members: [{ id: memberId(), token, name, host: true, online: true, fid }], bots: 0, mode: fresh!.mode, deckSize: fresh!.deckSize, cheat: fresh!.cheat }
        lobbyRef.current = l
        setLobbyState(l)
        setPhase(restore?.game && !restore.game.over ? 'playing' : 'lobby')
      },
      onReconnecting: setReconnecting,
      onJoin: (t, guestName, guestFid) => {
        const seatTaken = seats.current.get(t)
        const g = gameRef.current
        if (g && !g.over) {
          if (seatTaken === undefined) {
            // Someone new while a game is on waits in the room and sits down at the next game.
            const l = lobbyRef.current
            if (l && !l.members.some((m) => m.token === t) && l.members.length < maxPlayers(l.deckSize)) say(`${guestName} ждёт следующую партию`)
          } else {
          // A returning player gets the table as it is now, and their seat back from the bot.
          host.current?.send(t, { t: 'state', view: viewFor(g, seatTaken), seat: seatTaken })
          if (!g.players[seatTaken].human) {
            setGame((cur) => {
              if (!cur) return cur
              const next = structuredClone(cur)
              next.players[seatTaken].human = true
              return next
            })
            say(`${guestName} вернулся`)
          }
          }
        }
        updateLobby((l) => {
          const known = l.members.find((m) => m.token === t)
          if (known) return { ...l, members: l.members.map((m) => (m.token === t ? { ...m, name: guestName, online: true, fid: guestFid ?? m.fid } : m)) }
          if (l.members.length >= maxPlayers(l.deckSize)) {
            host.current?.dismiss(t, 'Комната заполнена: за столом нет свободных мест.', 'full')
            return l
          }
          return { ...l, members: [...l.members, { id: memberId(), token: t, name: guestName, host: false, online: true, fid: guestFid }] }
        })
      },
      onAway: (t, on) => updateLobby((l) => ({ ...l, members: l.members.map((m) => (m.token === t ? { ...m, away: on } : m)) })),
      onPeek: () => {
        const l = lobbyRef.current
        if (!l) return null
        const g = gameRef.current
        return {
          host: l.members.find((m) => m.host)?.name ?? 'Хост',
          mode: l.mode,
          deckSize: l.deckSize,
          stake: l.stake ?? 0,
          players: l.members.filter((m) => m.online).length + l.bots,
          max: maxPlayers(l.deckSize),
          playing: !!g && !g.over,
        } satisfies RoomPreview
      },
      onLeave: (t) => {
        const s = seats.current.get(t)
        setGame((g) => {
          if (!g || g.over || s === undefined) return g
          const next = structuredClone(g)
          next.players[s].human = false
          say(`${next.players[s].name} без связи, за него играет бот`)
          return next
        })
        updateLobby((l) => (s === undefined ? { ...l, members: l.members.filter((m) => m.token !== t) } : { ...l, members: l.members.map((m) => (m.token === t ? { ...m, online: false, away: false } : m)) }))
      },
      onAction: (t, action) => {
        const s = seats.current.get(t)
        if (s === undefined) return
        setGame((g) => {
          if (!g) return g
          try {
            return applyAction(own(g, s), s, action)
          } catch {
            // Out of turn or no longer legal: say so, and resend the table in case the guest's view is behind.
            setTimeout(() => {
              host.current?.send(t, { t: 'reject', reason: 'Этот ход уже нельзя сделать' })
              host.current?.send(t, { t: 'state', view: viewFor(g, s), seat: s })
            }, 0)
            return g
          }
        })
      },
      onEmote: (t, emoji) => {
        const s = seats.current.get(t)
        if (s !== undefined && EMOTES.includes(emoji)) emitEmote(s, emoji)
      },
      onError: (err) => {
        if (midGame()) endRef.current?.('interrupted')
        setError(err)
        setPhase('error')
        setReconnecting(false)
        writeSaved(null)
      },
    }, restore?.code, token)
  }

  const create: Online['create'] = ({ name, mode, deckSize, cheat }) => {
    lastCreate.current = { name, mode, deckSize, cheat }
    openHost(name, null, { mode, deckSize, cheat })
  }

  const join: Online['join'] = (roomCode, name) => {
    nameRef.current = name
    lastCreate.current = null
    setRole('guest')
    setPhase('connecting')
    setError(null)
    setCode(roomCode)
    setStage(null)
    setSlow(false)
    setHostAway(false)
    setLostAt(0)
    guest.current?.close()
    guest.current = new GuestRoom(roomCode, name, token, fid, {
      onStage: setStage,
      onSlow: () => setSlow(true),
      onConnected: () => {
        setSlow(false)
        setHostAway(false)
      },
      onReconnecting: (on) => {
        setReconnecting(on)
        setLostAt((at) => (on ? at || Date.now() : 0))
      },
      onMessage: (msg: ToGuest) => {
        if (msg.t === 'lobby') {
          setLobbyState(msg.lobby)
          setPhase((p) => (p === 'playing' ? p : 'lobby'))
        } else if (msg.t === 'tolobby') {
          setGame(null)
          setPhase('lobby')
        } else if (msg.t === 'away') {
          setHostAway(msg.on)
        } else if (msg.t === 'state') {
          setSeat(msg.seat)
          setGame(msg.view)
          setPhase('playing')
        } else if (msg.t === 'emote') {
          setEmote({ seat: msg.seat, emoji: msg.emoji, key: Date.now() })
        } else if (msg.t === 'reject') {
          say(msg.reason)
        } else if (msg.t === 'closed') {
          if (midGame()) endRef.current?.('interrupted')
          setError({ message: msg.reason, kind: msg.kind ?? kindOf(msg.reason) })
          setPhase('error')
          setReconnecting(false)
          writeSaved(null)
        }
      },
      onLost: (err) => {
        if (midGame()) endRef.current?.('interrupted')
        setError(err)
        setPhase('error')
        setReconnecting(false)
        writeSaved(null)
      },
    })
  }

  const leave = () => {
    if (midGame()) endRef.current?.('left')
    host.current?.close()
    guest.current?.close()
    host.current = null
    guest.current = null
    lobbyRef.current = null
    seats.current = new Map()
    setLobbyState(null)
    setGame(null)
    setRole(null)
    setError(null)
    setReconnecting(false)
    setStage(null)
    setSlow(false)
    setLostAt(0)
    setHostAway(false)
    setPhase('idle')
    writeSaved(null)
  }

  const retry = () => {
    const again = role === 'guest' ? code : null
    const opts = lastCreate.current
    leave()
    if (again) join(again, nameRef.current || 'Игрок')
    else if (opts) create(opts)
  }

  /** Host: from a finished game back to the room; everyone goes along. */
  const toLobby = () => {
    if (role !== 'host' || (gameRef.current && !gameRef.current.over)) return
    gameRef.current = null
    seats.current = new Map()
    setGame(null)
    setPhase('lobby')
    host.current?.broadcast({ t: 'tolobby' })
    updateLobby((cur) => cur)
  }

  /** Picks up the room this device was in before the app was reloaded. */
  const restore = () => {
    const saved = loadSaved()
    if (!saved || role) return false
    if (saved.role === 'host') openHost(saved.name, saved)
    else join(saved.code, saved.name)
    return true
  }

  const start = (level: Level = 'normal') => {
    const l = lobbyRef.current
    if (!l || role !== 'host') return
    const online: Member[] = l.members.filter((m) => m.online)
    const players = Math.min(online.length + l.bots, maxPlayers(l.deckSize))
    if (players < 2) return
    seats.current = new Map(online.map((m, i) => [m.token ?? '', i]))
    const names = [...online.map((m) => m.name), ...BOT_NAMES]
    const g = newGame({
      players,
      deckSize: l.deckSize,
      mode: l.mode,
      cheat: l.cheat,
      stake: l.stake ?? 0,
      level,
      names,
      human: 0,
      humans: online.map((_, i) => i),
    })
    strikes.current = new Map()
    gameRef.current = g
    setSeat(0)
    setGame(g)
    setPhase('playing')
    updateLobby((cur) => cur)
  }

  const act = (action: Action): boolean => {
    if (role === 'guest') return guest.current?.act(action) ?? false
    setGame((g) => {
        if (!g) return g
        try {
          return applyAction(role === 'host' ? own(g, 0) : g, 0, action)
        } catch {
          return g
        }
      })
    return true
  }

  /** Host: show an emote here and send it to every guest. */
  const emitEmote = (seat: number, emoji: string) => {
    setEmote({ seat, emoji, key: Date.now() + Math.random() })
    host.current?.broadcast({ t: 'emote', seat, emoji })
  }
  const sendEmote = (emoji: string) => {
    if (role === 'guest') guest.current?.emote(emoji)
    else emitEmote(0, emoji)
  }

  const setLobby: Online['setLobby'] = (patch) => updateLobby((l) => ({ ...l, ...patch }))
  const kick = (id: string) => {
    const t = lobbyRef.current?.members.find((m) => m.id === id)?.token
    if (!t || t === token) return
    host.current?.kick(t)
    updateLobby((l) => ({ ...l, members: l.members.filter((m) => m.token !== t) }))
  }

  const stepBot = (actor: number, level?: Level) => {
    const g = gameRef.current
    if (!g || currentActor(g) !== actor || g.players[actor].human) return
    think(g, actor, level).then((action) =>
      setGame((cur) => {
        if (cur !== g) return cur
        try {
          return applyAction(cur, actor, action)
        } catch {
          return cur
        }
      }),
    )
  }

  const botThrow = () =>
    setGame((g) => {
      const t = g && eagerThrow(g)
      return t ? applyAction(g, t.player, t.action) : g
    })

  // Unmounting (e.g. a reload) keeps the saved room; only `leave` forgets it.
  useEffect(() => () => {
    host.current?.close()
    guest.current?.close()
  }, [])

  const others = lobby ? Math.max(0, lobby.members.filter((m) => m.online).length - 1) : 0

  return { phase, role, error, code, stage, slow, lostAt, hostAway, others, lobby, game, seat, notice, reconnecting, create, join, leave, retry, start, toLobby, act, setLobby, kick, stepBot, restore, emote, sendEmote, emitEmote, botThrow }
}

