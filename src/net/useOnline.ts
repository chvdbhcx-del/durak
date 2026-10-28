import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckSize } from '../engine/cards'
import { chooseAction } from '../engine/bot'
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
  create: (opts: { name: string; mode: Mode; deckSize: DeckSize }) => void
  join: (code: string, name: string) => void
  leave: () => void
  start: () => void
  act: (action: Action) => void
  setLobby: (patch: Partial<Pick<LobbyInfo, 'bots' | 'mode' | 'deckSize'>>) => void
  kick: (token: string) => void
  /** host only: let the bot in `actor`'s seat make its move */
  stepBot: (actor: number) => void
}

/** Keeps the bot count within what the deck can seat. */
function fitBots(lobby: LobbyInfo): LobbyInfo {
  const room = maxPlayers(lobby.deckSize) - lobby.members.length
  return { ...lobby, bots: Math.max(0, Math.min(lobby.bots, room)) }
}

export function useOnline(token: string): Online {
  const [phase, setPhase] = useState<OnlinePhase>('idle')
  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lobby, setLobbyState] = useState<LobbyInfo | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [seat, setSeat] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

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
      const next = fitBots(fn(prev))
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

  const create: Online['create'] = ({ name, mode, deckSize }) => {
    setRole('host')
    setPhase('connecting')
    setError(null)
    seats.current = new Map()
    host.current = new HostRoom({
      onReady: (code) => {
        const l: LobbyInfo = { code, members: [{ token, name, host: true, online: true }], bots: 0, mode, deckSize }
        lobbyRef.current = l
        setLobbyState(l)
        setPhase('lobby')
      },
      onJoin: (t, guestName) => {
        const seatTaken = seats.current.get(t)
        setGame((g) => {
          if (g && !g.over) {
            if (seatTaken === undefined) {
              host.current?.send(t, { t: 'closed', reason: 'Партия уже идёт. Дождитесь следующей.' })
              return g
            }
            // A dropped player returns: give the seat back from the bot.
            const next = structuredClone(g)
            next.players[seatTaken].human = true
            say(`${guestName} вернулся`)
            return next
          }
          return g
        })
        updateLobby((l) => {
          const known = l.members.find((m) => m.token === t)
          if (known) return { ...l, members: l.members.map((m) => (m.token === t ? { ...m, name: guestName, online: true } : m)) }
          if (l.members.length >= maxPlayers(l.deckSize)) {
            host.current?.send(t, { t: 'closed', reason: 'Комната заполнена.' })
            return l
          }
          return { ...l, members: [...l.members, { token: t, name: guestName, host: false, online: true }] }
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
      onError: (message) => {
        setError(message)
        setPhase('error')
      },
    })
  }

  const join: Online['join'] = (code, name) => {
    setRole('guest')
    setPhase('connecting')
    setError(null)
    guest.current = new GuestRoom(code, name, token, {
      onConnected: () => {},
      onMessage: (msg: ToGuest) => {
        if (msg.t === 'lobby') {
          setLobbyState(msg.lobby)
          setPhase((p) => (p === 'playing' ? p : 'lobby'))
        } else if (msg.t === 'state') {
          setSeat(msg.seat)
          setGame(msg.view)
          setPhase('playing')
        } else if (msg.t === 'closed') {
          setError(msg.reason)
          setPhase('error')
        }
      },
      onLost: (message) => {
        setError(message)
        setPhase('error')
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
    setPhase('idle')
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
      names,
      human: 0,
      humans: online.map((_, i) => i),
      seed: Date.now(),
    })
    setSeat(0)
    setGame(g)
    setPhase('playing')
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

  const setLobby: Online['setLobby'] = (patch) => updateLobby((l) => ({ ...l, ...patch }))
  const kick = (t: string) => {
    host.current?.kick(t)
    updateLobby((l) => ({ ...l, members: l.members.filter((m) => m.token !== t) }))
  }

  const stepBot = (actor: number) =>
    setGame((g) => (g && currentActor(g) === actor && !g.players[actor].human ? applyAction(g, actor, chooseAction(g, actor)) : g))

  useEffect(() => () => {
    host.current?.close()
    guest.current?.close()
  }, [])

  return { phase, role, error, lobby, game, seat, notice, create, join, leave, start, act, setLobby, kick, stepBot }
}

