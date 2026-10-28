import Peer, { type DataConnection } from 'peerjs'
import type { Action, GameState } from '../engine/game'

/**
 * Online rooms without our own server. The host's device runs the game; friends connect
 * to it directly (WebRTC) by a short room code. PeerJS's public broker only introduces
 * the devices to each other; game traffic goes peer to peer.
 */

const PREFIX = 'durak-cx-'
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 5

export interface Member {
  token: string
  name: string
  host: boolean
  online: boolean
}

export interface LobbyInfo {
  code: string
  members: Member[]
  bots: number
  mode: GameState['options']['mode']
  deckSize: GameState['options']['deckSize']
}

export type ToGuest =
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'state'; view: GameState; seat: number }
  | { t: 'closed'; reason: string }

export type ToHost = { t: 'hello'; name: string; token: string } | { t: 'act'; action: Action }

export function randomCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return code
}

export function normalizeCode(raw: string) {
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => ALPHABET.includes(ch))
    .join('')
    .slice(0, CODE_LENGTH)
}

const peerOptions = { debug: 0 as const }

function describe(err: { type?: string }) {
  switch (err.type) {
    case 'peer-unavailable':
      return 'Комната не найдена. Проверьте код.'
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Нет связи с сервером комнат. Проверьте интернет.'
    case 'browser-incompatible':
      return 'Этот браузер не поддерживает онлайн-игру.'
    default:
      return 'Не удалось подключиться. Попробуйте ещё раз.'
  }
}

export interface HostEvents {
  onReady: (code: string) => void
  onJoin: (token: string, name: string) => void
  onLeave: (token: string) => void
  onAction: (token: string, action: Action) => void
  onError: (message: string) => void
}

export class HostRoom {
  private peer: Peer | null = null
  private conns = new Map<string, DataConnection>()
  code = ''

  constructor(private events: HostEvents) {
    this.open(0)
  }

  private open(attempt: number) {
    this.code = randomCode()
    const peer = new Peer(PREFIX + this.code, peerOptions)
    this.peer = peer
    peer.on('open', () => this.events.onReady(this.code))
    peer.on('error', (err) => {
      // Someone already holds this code: pick another.
      if (err.type === 'unavailable-id' && attempt < 5) {
        peer.destroy()
        this.open(attempt + 1)
      } else this.events.onError(describe(err))
    })
    peer.on('disconnected', () => peer.reconnect())
    peer.on('connection', (conn) => {
      let token = ''
      conn.on('data', (raw) => {
        const msg = raw as ToHost
        if (msg.t === 'hello') {
          token = msg.token
          this.conns.get(token)?.close()
          this.conns.set(token, conn)
          this.events.onJoin(token, msg.name.slice(0, 16) || 'Гость')
        } else if (msg.t === 'act' && token) this.events.onAction(token, msg.action)
      })
      conn.on('close', () => {
        if (token && this.conns.get(token) === conn) {
          this.conns.delete(token)
          this.events.onLeave(token)
        }
      })
    })
  }

  send(token: string, msg: ToGuest) {
    const conn = this.conns.get(token)
    if (conn?.open) conn.send(msg)
  }

  broadcast(msg: ToGuest) {
    for (const conn of this.conns.values()) if (conn.open) conn.send(msg)
  }

  kick(token: string) {
    this.send(token, { t: 'closed', reason: 'Хозяин убрал вас из комнаты.' })
    setTimeout(() => this.conns.get(token)?.close(), 200)
  }

  close() {
    this.broadcast({ t: 'closed', reason: 'Хозяин закрыл комнату.' })
    setTimeout(() => this.peer?.destroy(), 300)
  }
}

export interface GuestEvents {
  onConnected: () => void
  onMessage: (msg: ToGuest) => void
  onLost: (message: string) => void
}

export class GuestRoom {
  private peer: Peer
  private conn: DataConnection | null = null
  private closedByHost = false

  constructor(
    public code: string,
    private name: string,
    private token: string,
    private events: GuestEvents,
  ) {
    this.peer = new Peer(peerOptions)
    this.peer.on('open', () => this.connect())
    this.peer.on('error', (err) => this.events.onLost(describe(err)))
  }

  private connect() {
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true })
    this.conn = conn
    conn.on('open', () => {
      conn.send({ t: 'hello', name: this.name, token: this.token } satisfies ToHost)
      this.events.onConnected()
    })
    conn.on('data', (raw) => {
      const msg = raw as ToGuest
      if (msg.t === 'closed') this.closedByHost = true
      this.events.onMessage(msg)
    })
    conn.on('close', () => {
      if (!this.closedByHost) this.events.onLost('Связь с хозяином комнаты потеряна.')
    })
  }

  act(action: Action) {
    if (this.conn?.open) this.conn.send({ t: 'act', action } satisfies ToHost)
  }

  close() {
    this.closedByHost = true
    this.conn?.close()
    setTimeout(() => this.peer.destroy(), 200)
  }
}
