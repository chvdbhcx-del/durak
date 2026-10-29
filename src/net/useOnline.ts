import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckSize } from '../engine/cards'
import { chooseAction, type Level } from '../engine/bot'
import { EMOTES, type Emote } from '../engine/emotes'
import { Action, applyAction, currentActor, GameState, maxPlayers, Mode, newGame, viewFor } from '../engine/game'
import { BOT_NAMES } from '../ui/pickers'
import { GuestRoom, HostRoom, LobbyInfo, Member, ToGuest } from './room'

export type OnlinePhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'error'

export interface Online {
  phase: OnlinePhase
  role: 'host' | 'guest' | null
  error: string | null
  lobby: LobbyInfo | null
  game: GameState | null
  seat: number
  notice: string | null
  /** the connection dropped (e.g. the app was in the background) and is coming back */
  reconnecting: boolean
  create: (opts: { name: string; mode: Mode; deckSize: DeckSize; cheat?: boolean }) => void
  join: (code: string, name: string) => void
  leave: () => void
  start: () => void
  act: (action: Action) => void
  setLobby: (patch: Partial<Pick<LobbyInfo, 'bots' | 'mode' | 'deckSize' | 'cheat'>>) => void
  kick: (token: string) => void
  /** host only: let the bot in `actor`'s seat make its move */
  stepBot: (actor: number, level?: Level) => void
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

const SAVE_KEY = 'durak.online'
const SAVE_TTL_MS = 20 * 60 * 1000

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    const saved = raw ? (JSON.parse(raw) as Saved) : null
    return saved && Date.now() - saved.savedAt < SAVE_TTL_MS ? saved : null
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

export function useOnline(token: string, fid: string): Online {
  const [phase, setPhase] = useState<OnlinePhase>('idle')
  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      const base = fitBots(fn(prev))
      const roster = base.members.filter((m) => seats.current.has(m.token)).map((m) => ({ seat: seats.current.get(m.token)!, name: m.name, fid: m.fid }))
      const next = roster.length ? { ...base, roster } : { ...base, roster: undefined }
      lobbyRef.current = next
      host.current?.broadcast({ t: 'lobby', lobby: next })
      return next
    })
  }, [])

  // The host is the single source of truth: every change goes out as a per-seat view.
  useEffect(() => {
    if (role !== 'host' || !game || !host.current) return
    for (const [t, s] of seats.current) if (t !== token) host.current.send(t, { t: 'state', view: viewFor(game, s), seat: s })
  }, [game, role, token])

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
      if (document.visibilityState !== 'visible') return
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
    seats.current = new Map(restore?.seats ?? [])
    if (restore?.game) {
      // Friends count as away until they reconnect; bots keep their seats warm meanwhile.
      const g = structuredClone(restore.game)
      for (const [t, s] of seats.current) if (t !== token && g.players[s]) g.players[s].human = false
      setGame(g)
    }
    host.current = new HostRoom({
      onReady: (code) => {
        const l: LobbyInfo = restore?.lobby
          ? { ...restore.lobby, members: restore.lobby.members.map((m) => ({ ...m, online: m.token === token, fid: m.token === token ? fid : m.fid })) }
          : { code, members: [{ token, name, host: true, online: true, fid }], bots: 0, mode: fresh!.mode, deckSize: fresh!.deckSize, cheat: fresh!.cheat }
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
            host.current?.send(t, { t: 'closed', reason: 'Партия уже идёт. Дождитесь следующей.' })
            return
          }
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
        updateLobby((l) => {
          const known = l.members.find((m) => m.token === t)
          if (known) return { ...l, members: l.members.map((m) => (m.token === t ? { ...m, name: guestName, online: true, fid: guestFid ?? m.fid } : m)) }
          if (l.members.length >= maxPlayers(l.deckSize)) {
            host.current?.send(t, { t: 'closed', reason: 'Комната заполнена.' })
            return l
          }
          return { ...l, members: [...l.members, { token: t, name: guestName, host: false, online: true, fid: guestFid }] }
        })
      },
      onLeave: (t) => {
        const s = seats.current.get(t)
        setGame((g) => {
          if (!g || g.over || s === undefined) return g
          const next = structuredClone(g)
          next.players[s].human = false
          say(`${next.players[s].name} отключился, за него играет бот`)
          return next
        })
        updateLobby((l) => (s === undefined ? { ...l, members: l.members.filter((m) => m.token !== t) } : { ...l, members: l.members.map((m) => (m.token === t ? { ...m, online: false } : m)) }))
      },
      onAction: (t, action) => {
        const s = seats.current.get(t)
        if (s === undefined) return
        setGame((g) => {
          if (!g) return g
          try {
            return applyAction(g, s, action)
          } catch {
            return g
          }
        })
      },
      onEmote: (t, emoji) => {
        const s = seats.current.get(t)
        if (s !== undefined && EMOTES.includes(emoji)) emitEmote(s, emoji)
      },
      onError: (message) => {
        setError(message)
        setPhase('error')
        writeSaved(null)
      },
    }, restore?.code)
  }

  const create: Online['create'] = ({ name, mode, deckSize, cheat }) => openHost(name, null, { mode, deckSize, cheat })

  const join: Online['join'] = (code, name) => {
    nameRef.current = name
    setRole('guest')
    setPhase('connecting')
    setError(null)
    guest.current = new GuestRoom(code, name, token, fid, {
      onConnected: () => {},
      onReconnecting: setReconnecting,
      onMessage: (msg: ToGuest) => {
        if (msg.t === 'lobby') {
          setLobbyState(msg.lobby)
          setPhase((p) => (p === 'playing' ? p : 'lobby'))
        } else if (msg.t === 'state') {
          setSeat(msg.seat)
          setGame(msg.view)
          setPhase('playing')
        } else if (msg.t === 'emote') {
          setEmote({ seat: msg.seat, emoji: msg.emoji, key: Date.now() })
        } else if (msg.t === 'closed') {
          setError(msg.reason)
          setPhase('error')
          writeSaved(null)
        }
      },
      onLost: (message) => {
        setError(message)
        setPhase('error')
        setReconnecting(false)
        writeSaved(null)
      },
    })
  }

  const leave = () => {
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
    setPhase('idle')
    writeSaved(null)
  }

  /** Picks up the room this device was in before the app was reloaded. */
  const restore = () => {
    const saved = loadSaved()
    if (!saved || role) return false
    if (saved.role === 'host') openHost(saved.name, saved)
    else join(saved.code, saved.name)
    return true
  }

  const start = () => {
    const l = lobbyRef.current
    if (!l || role !== 'host') return
    const online: Member[] = l.members.filter((m) => m.online)
    const players = Math.min(online.length + l.bots, maxPlayers(l.deckSize))
    if (players < 2) return
    seats.current = new Map(online.map((m, i) => [m.token, i]))
    const names = [...online.map((m) => m.name), ...BOT_NAMES]
    const g = newGame({
      players,
      deckSize: l.deckSize,
      mode: l.mode,
      cheat: l.cheat,
      names,
      human: 0,
      humans: online.map((_, i) => i),
      seed: Date.now(),
    })
    setSeat(0)
    setGame(g)
    setPhase('playing')
    updateLobby((cur) => cur)
  }

  const act = (action: Action) => {
    if (role === 'guest') guest.current?.act(action)
    else
      setGame((g) => {
        if (!g) return g
        try {
          return applyAction(g, 0, action)
        } catch {
          return g
        }
      })
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
  const kick = (t: string) => {
    host.current?.kick(t)
    updateLobby((l) => ({ ...l, members: l.members.filter((m) => m.token !== t) }))
  }

  const stepBot = (actor: number, level: Level = 'normal') =>
    setGame((g) => (g && currentActor(g) === actor && !g.players[actor].human ? applyAction(g, actor, chooseAction(g, actor, level)) : g))

  // Unmounting (e.g. a reload) keeps the saved room; only `leave` forgets it.
  useEffect(() => () => {
    host.current?.close()
    guest.current?.close()
  }, [])

  return { phase, role, error, lobby, game, seat, notice, reconnecting, create, join, leave, start, act, setLobby, kick, stepBot, restore, emote, sendEmote, emitEmote }
}

