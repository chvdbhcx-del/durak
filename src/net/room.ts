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
  /** public seat name in the lobby, shared with everyone; kicks and lists use it */
  id: string
  /** the device's secret token: only the host keeps it, guests never see anyone's */
  token?: string
  name: string
  host: boolean
  online: boolean
  /** public friend id, so others can add this player; never the secret device token */
  fid?: string
}

/** Who sits where once a game is on, so a seat can be turned into a friend. */
export interface RosterEntry {
  seat: number
  name: string
  fid?: string
}

export interface LobbyInfo {
  code: string
  members: Member[]
  bots: number
  mode: GameState['options']['mode']
  deckSize: GameState['options']['deckSize']
  cheat?: boolean
  /** coins at stake per game, chosen by the host; 0 or missing plays for nothing */
  stake?: number
  roster?: RosterEntry[]
}

export type ToGuest =
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'state'; view: GameState; seat: number }
  | { t: 'emote'; seat: number; emoji: string }
  | { t: 'closed'; reason: string }
  /** the host turned a move down (out of turn, or no longer legal) */
  | { t: 'reject'; reason: string }

export type ToHost = { t: 'hello'; name: string; token: string; fid?: string } | { t: 'act'; action: Action } | { t: 'emote'; emoji: string }

/** The lobby as guests see it: without anyone's device token, which would let a guest take over another seat. */
export function publicLobby(l: LobbyInfo): LobbyInfo {
  return { ...l, members: l.members.map(({ token: _secret, ...m }) => m) }
}

/** A short random id for a lobby seat. */
export function memberId(): string {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('')
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)
const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null)

function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  switch (a.type) {
    case 'take':
    case 'pass':
      return { type: a.type }
    case 'attack':
    case 'transfer': {
      const cardId = str(a.cardId, 24)
      return cardId ? { type: a.type, cardId } : null
    }
    case 'defend': {
      const cardId = str(a.cardId, 24)
      const pair = int(a.pair, 12)
      return cardId && pair !== null ? { type: 'defend', cardId, pair } : null
    }
    case 'accuse': {
      const pair = int(a.pair, 12)
      return pair !== null ? { type: 'accuse', pair } : null
    }
    case 'throw': {
      if (!Array.isArray(a.cardIds) || a.cardIds.length === 0 || a.cardIds.length > 6) return null
      const ids = a.cardIds.map((id) => str(id, 24))
      return ids.every((id): id is string => !!id) ? { type: 'throw', cardIds: ids } : null
    }
    default:
      // bluffs are for bots only and never come over the wire
      return null
  }
}

/** Messages come from other devices, so nothing is trusted until its shape is checked. */
export function parseToHost(raw: unknown): ToHost | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.t === 'hello') {
    const token = str(m.token, 64)
    if (!token || typeof m.name !== 'string') return null
    const fid = str(m.fid, 32)
    return { t: 'hello', name: m.name.slice(0, 16), token, ...(fid ? { fid } : {}) }
  }
  if (m.t === 'act') {
    const action = parseAction(m.action)
    return action ? { t: 'act', action } : null
  }
  if (m.t === 'emote') {
    const emoji = str(m.emoji, 8)
    return emoji ? { t: 'emote', emoji } : null
  }
  return null
}

/** Messages a guest may send per second before the rest are dropped. */
const RATE_PER_SEC = 20

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

/** Where rooms are introduced: PeerJS's public broker unless the player points the app at their own server. */
interface OwnServer {
  host: string
  port: number
  path: string
  secure: boolean
}
let ownServer: OwnServer | null = null

/** Accepts `https://name.example.com`, `name.example.com:9000` or `http://192.168.1.5:9000`; empty or unreadable means the public broker. */
export function parseServer(raw: string): OwnServer | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const secure = url.protocol === 'https:'
    return { host: url.hostname, port: url.port ? Number(url.port) : secure ? 443 : 80, path: url.pathname.replace(/\/$/, '') || '/', secure }
  } catch {
    return null
  }
}

export function setRoomServer(raw: string) {
  ownServer = parseServer(raw)
}

export const peerOptions = () => ({ debug: 0 as const, ...(ownServer ?? {}) })

/** How long the first link to the room broker may take before we say so instead of spinning forever. */
const BROKER_TIMEOUT_MS = 15000
const BROKER_SLOW = 'Сервер комнат не отвечает. Проверьте интернет или попробуйте через минуту. Если не помогает, возможно, ваша сеть его блокирует (попробуйте другой Wi-Fi или мобильный интернет).'

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

/** Errors that mean "the line dropped" (a phone app sent to the background, a flaky network), not "this can't work". */
const TRANSIENT = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'webrtc'])

export interface HostEvents {
  onReady: (code: string) => void
  onJoin: (token: string, name: string, fid?: string) => void
  onLeave: (token: string) => void
  onAction: (token: string, action: Action) => void
  onEmote: (token: string, emoji: string) => void
  onError: (message: string) => void
  /** true while the link to the room broker is down and being restored */
  onReconnecting: (on: boolean) => void
}

export const SAME_DEVICE = 'Эта комната открыта на этом же устройстве. Отправьте ссылку другому игроку.'

export class HostRoom {
  private peer: Peer | null = null
  private conns = new Map<string, DataConnection>()
  private ready = false
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  code = ''

  /**
   * `code` reopens a room that already exists, e.g. after the app was reloaded. `ownToken` is the host's
   * device token: a guest arriving with it is this same browser profile (another tab, or a home-screen
   * site sharing the browser's storage) and would take over the host's seat, so it is turned away.
   */
  constructor(
    private events: HostEvents,
    code?: string,
    private ownToken = '',
  ) {
    this.code = code ?? randomCode()
    this.open(0, !!code)
  }

  private open(attempt: number, keepCode: boolean) {
    if (this.closed) return
    const peer = new Peer(PREFIX + this.code, peerOptions())
    this.peer = peer
    const slow = this.ready || keepCode ? null : setTimeout(() => {
      if (this.closed || this.peer !== peer || this.ready) return
      peer.destroy()
      this.events.onError(BROKER_SLOW)
    }, BROKER_TIMEOUT_MS)
    peer.on('open', () => {
      if (slow) clearTimeout(slow)
      this.events.onReconnecting(false)
      if (!this.ready) {
        this.ready = true
        this.events.onReady(this.code)
      }
    })
    peer.on('error', (err) => {
      if (this.closed || this.peer !== peer) return
      if (slow && err.type !== 'unavailable-id') clearTimeout(slow)
      if (err.type === 'unavailable-id') {
        peer.destroy()
        // Our own old registration may linger for a minute after a reload: wait it out.
        if (keepCode || this.ready) {
          if (attempt < 25) this.later(() => this.open(attempt + 1, true), 3000)
          else this.events.onError('Не получилось снова открыть комнату. Создайте новую.')
        } else if (attempt < 5) {
          this.code = randomCode()
          this.open(attempt + 1, false)
        } else this.events.onError(describe(err))
        return
      }
      if (err.type === 'peer-unavailable') return // a guest left mid-handshake
      if (TRANSIENT.has(err.type) && (this.ready || keepCode)) return this.recover()
      this.events.onError(describe(err))
    })
    peer.on('disconnected', () => this.recover())
    peer.on('connection', (conn) => {
      let token = ''
      let windowStart = 0
      let count = 0
      conn.on('data', (raw) => {
        const now = Date.now()
        if (now - windowStart > 1000) {
          windowStart = now
          count = 0
        }
        if (++count > RATE_PER_SEC) return
        const msg = parseToHost(raw)
        if (!msg) return
        if (msg.t === 'hello') {
          if (this.ownToken && msg.token === this.ownToken) {
            conn.send({ t: 'closed', reason: SAME_DEVICE } satisfies ToGuest)
            setTimeout(() => conn.close(), 200)
            return
          }
          token = msg.token
          const old = this.conns.get(token)
          this.conns.set(token, conn)
          if (old && old !== conn) old.close()
          this.events.onJoin(token, msg.name.trim() || 'Гость', msg.fid)
        } else if (msg.t === 'act' && token) this.events.onAction(token, msg.action)
        else if (msg.t === 'emote' && token) this.events.onEmote(token, msg.emoji)
      })
      conn.on('close', () => {
        if (token && this.conns.get(token) === conn) {
          this.conns.delete(token)
          this.events.onLeave(token)
        }
      })
    })
  }

  private later(fn: () => void, ms: number) {
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => {
      this.retry = null
      fn()
    }, ms)
  }

  /** Restores the link to the broker; friends already connected keep playing meanwhile. */
  private recover() {
    const peer = this.peer
    if (this.closed || !peer) return
    this.events.onReconnecting(true)
    if (peer.destroyed) return this.later(() => this.open(0, true), 1000)
    this.later(() => {
      if (this.peer !== peer || this.closed) return
      if (peer.destroyed) this.open(0, true)
      else if (peer.disconnected) {
        try {
          peer.reconnect()
        } catch {
          peer.destroy()
          this.open(0, true)
          return
        }
        // Still down a bit later: try again.
        this.later(() => this.peer === peer && peer.disconnected && this.recover(), 5000)
      } else this.events.onReconnecting(false)
    }, 800)
  }

  /** Call when the app comes back to the foreground. */
  resume() {
    if (this.peer && (this.peer.disconnected || this.peer.destroyed)) this.recover()
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
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    this.broadcast({ t: 'closed', reason: 'Хозяин закрыл комнату.' })
    setTimeout(() => this.peer?.destroy(), 300)
  }
}

export interface GuestEvents {
  onConnected: () => void
  onMessage: (msg: ToGuest) => void
  onLost: (message: string) => void
  onReconnecting: (on: boolean) => void
}

/** How long a guest keeps trying to get back into the room before giving up. */
const GUEST_PATIENCE_MS = 90_000

export class GuestRoom {
  private peer: Peer
  private conn: DataConnection | null = null
  private done = false
  private everConnected = false
  private lostAt = 0
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(
    public code: string,
    private name: string,
    private token: string,
    private fid: string,
    private events: GuestEvents,
  ) {
    this.peer = this.makePeer()
  }

  private makePeer() {
    const peer = new Peer(peerOptions())
    const slow = this.everConnected ? null : setTimeout(() => {
      if (this.done || this.peer !== peer || peer.open) return
      this.done = true
      peer.destroy()
      this.events.onLost(BROKER_SLOW)
    }, BROKER_TIMEOUT_MS)
    peer.on('open', () => {
      if (slow) clearTimeout(slow)
      this.connect()
    })
    peer.on('disconnected', () => {
      if (!this.done && this.everConnected) this.later(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1000)
    })
    peer.on('error', (err) => {
      if (this.done || this.peer !== peer) return
      if (this.everConnected && (TRANSIENT.has(err.type) || err.type === 'peer-unavailable')) return this.dropped()
      this.done = true
      this.events.onLost(describe(err))
    })
    return peer
  }

  private connect() {
    if (this.done) return
    this.conn?.close()
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true })
    this.conn = conn
    conn.on('open', () => {
      conn.send({ t: 'hello', name: this.name, token: this.token, fid: this.fid } satisfies ToHost)
      this.everConnected = true
      this.lostAt = 0
      this.events.onReconnecting(false)
      this.events.onConnected()
    })
    conn.on('data', (raw) => {
      const msg = raw as ToGuest
      if (msg.t === 'closed') this.done = true
      this.events.onMessage(msg)
    })
    conn.on('close', () => {
      if (this.conn === conn) this.dropped()
    })
  }

  private later(fn: () => void, ms: number) {
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => {
      this.retry = null
      fn()
    }, ms)
  }

  /** The link to the host broke: keep knocking until it answers or patience runs out. */
  private dropped() {
    if (this.done) return
    if (!this.lostAt) this.lostAt = Date.now()
    if (Date.now() - this.lostAt > GUEST_PATIENCE_MS) {
      this.done = true
      this.events.onLost('Связь с хозяином комнаты потеряна.')
      return
    }
    this.events.onReconnecting(true)
    this.later(() => {
      if (this.done) return
      if (this.peer.destroyed) this.peer = this.makePeer()
      else if (this.peer.disconnected) this.peer.reconnect()
      else this.connect()
      // No answer: try again.
      this.later(() => !this.conn?.open && this.dropped(), 6000)
    }, 1500)
  }

  /** Call when the app comes back to the foreground. */
  resume() {
    if (!this.done && this.everConnected && !this.conn?.open) {
      this.lostAt = this.lostAt || Date.now()
      this.dropped()
    }
  }

  act(action: Action) {
    if (this.conn?.open) this.conn.send({ t: 'act', action } satisfies ToHost)
  }

  emote(emoji: string) {
    if (this.conn?.open) this.conn.send({ t: 'emote', emoji } satisfies ToHost)
  }

  close() {
    this.done = true
    if (this.retry) clearTimeout(this.retry)
    this.conn?.close()
    setTimeout(() => this.peer.destroy(), 200)
  }
}
