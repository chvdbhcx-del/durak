import type Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
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
  /** the player's app is in the background */
  away?: boolean
}

/** Who sits where once a game is on, so a seat can be turned into a friend. */
export interface RosterEntry {
  seat: number
  name: string
  fid?: string
  /** the player's line is down: a bot keeps the seat warm until they are back */
  off?: boolean
  /** the player put the app in the background */
  away?: boolean
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
  /** a game is on; people who join now wait in the room for the next one. Missing from older hosts. */
  playing?: boolean
  /** a short note for everyone in the room, e.g. a bot giving up its seat */
  note?: { key: number; text: string }
}

/** Why a room could not be reached or ended, so each case gets its own next step. */
export type ErrorKind = 'not-found' | 'full' | 'closed' | 'kicked' | 'same-device' | 'network' | 'server' | 'p2p' | 'lost' | 'browser' | 'other'

/** What an invite shows before joining: who calls and to what game. */
export interface RoomPreview {
  host: string
  mode: GameState['options']['mode']
  deckSize: GameState['options']['deckSize']
  stake: number
  players: number
  max: number
  playing: boolean
}

export type ToGuest =
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'state'; view: GameState; seat: number }
  | { t: 'emote'; seat: number; emoji: string }
  | { t: 'closed'; reason: string; kind?: ErrorKind }
  /** the host turned a move down (out of turn, or no longer legal) */
  | { t: 'reject'; reason: string }
  /** a heartbeat every couple of seconds, so a host gone silent is noticed */
  | { t: 'ping' }
  /** the host put the app in the background (or came back) */
  | { t: 'away'; on: boolean }
  | { t: 'peek'; info: RoomPreview }
  /** the host took everyone from a finished game back to the room */
  | { t: 'tolobby' }

export type ToHost =
  | { t: 'hello'; name: string; token: string; fid?: string }
  | { t: 'act'; action: Action }
  | { t: 'emote'; emoji: string }
  | { t: 'pong' }
  | { t: 'away'; on: boolean }
  /** an invite asking what the room is, without joining it */
  | { t: 'peek' }

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
  if (m.t === 'pong' || m.t === 'peek') return { t: m.t }
  if (m.t === 'away' && typeof m.on === 'boolean') return { t: 'away', on: m.on }
  return null
}

/** A heartbeat goes out this often, both ways. */
export const PING_MS = 2500
/** No word from the other side for this long: the line is treated as dropped. */
export const SILENCE_MS = 7500
/** A timer that fired this late means the app itself was asleep, not the other side. */
const SLEPT_MS = 4000

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

/** PeerJS is loaded on its own, after the game has started, so it never slows the first screen. */
let PeerCtor: typeof Peer | null = null
let peerLoad: Promise<unknown> | null = null
export const loadPeer = () => (peerLoad ??= import('peerjs').then((m) => (PeerCtor = m.default)))
export const peerLoaded = () => PeerCtor !== null
export function createPeer(id?: string): Peer {
  return id ? new PeerCtor!(id, peerOptions()) : new PeerCtor!(peerOptions())
}
const LOAD_FAILED: RoomError = { message: 'Не удалось загрузить онлайн-игру. Проверьте интернет.', kind: 'network' }

/** How long the first link to the room broker may take before we say so instead of spinning forever. */
const BROKER_TIMEOUT_MS = 15000
const BROKER_SLOW: RoomError = { message: 'Сервер комнат не отвечает. Проверьте интернет или попробуйте через минуту.', kind: 'server' }
/** A guest whose direct link to the host does not open: first a word that it is slow, then an honest error. */
const LINK_SLOW_MS = 8000
const LINK_TIMEOUT_MS = 20000
const LINK_FAILED: RoomError = { message: 'Не удаётся связаться с хостом напрямую. Чаще всего мешает мобильный интернет: попробуйте Wi-Fi или попросите хоста создать комнату заново.', kind: 'p2p' }

export interface RoomError {
  message: string
  kind: ErrorKind
}

export function describe(err: { type?: string }): RoomError {
  switch (err.type) {
    case 'peer-unavailable':
      return { message: 'Комната не найдена. Возможно, хост её уже закрыл.', kind: 'not-found' }
    case 'network':
      return { message: 'Нет интернета. Проверьте подключение.', kind: 'network' }
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return { message: 'Сервер комнат не отвечает.', kind: 'server' }
    case 'browser-incompatible':
      return { message: 'Этот браузер не поддерживает онлайн-игру.', kind: 'browser' }
    default:
      return { message: 'Не удалось подключиться. Попробуйте ещё раз.', kind: 'other' }
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
  /** a guest put the app in the background, or came back */
  onAway: (token: string, on: boolean) => void
  /** an invite asks what the room is, before joining */
  onPeek: () => RoomPreview | null
  onError: (err: RoomError) => void
  /** true while the link to the room broker is down and being restored */
  onReconnecting: (on: boolean) => void
}

export const SAME_DEVICE = 'Это ваша же комната, открытая на этом устройстве. Отправьте ссылку другу.'

export class HostRoom {
  private peer: Peer | null = null
  private conns = new Map<string, DataConnection>()
  /** when each guest was last heard from, for those whose app answers the heartbeat */
  private heard = new Map<DataConnection, number>()
  private ready = false
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private beat: ReturnType<typeof setInterval> | null = null
  private lastBeat = Date.now()
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
    this.beat = setInterval(() => this.heartbeat(), PING_MS)
  }

  /** Pings every guest, and lets go of one that has gone silent so a bot can take over at once. */
  private heartbeat() {
    const now = Date.now()
    const slept = now - this.lastBeat > PING_MS + SLEPT_MS
    this.lastBeat = now
    for (const [token, conn] of this.conns) {
      if (!conn.open) continue
      conn.send({ t: 'ping' } satisfies ToGuest)
      const at = this.heard.get(conn)
      if (at === undefined) continue
      // This device was asleep itself: everyone gets a fresh chance to answer.
      if (slept) this.heard.set(conn, now)
      else if (now - at > SILENCE_MS) {
        this.heard.delete(conn)
        this.conns.delete(token)
        conn.close()
        this.events.onLeave(token)
      }
    }
  }

  private open(attempt: number, keepCode: boolean) {
    if (this.closed) return
    if (!PeerCtor) {
      loadPeer().then(
        () => this.open(attempt, keepCode),
        () => this.events.onError(LOAD_FAILED),
      )
      return
    }
    const peer = createPeer(PREFIX + this.code)
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
          else this.events.onError({ message: 'Не получилось снова открыть комнату. Создайте новую.', kind: 'other' })
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
        if (this.heard.has(conn)) this.heard.set(conn, now)
        if (now - windowStart > 1000) {
          windowStart = now
          count = 0
        }
        if (++count > RATE_PER_SEC) return
        const msg = parseToHost(raw)
        if (!msg) return
        if (msg.t === 'pong') {
          // Only guests whose app answers the heartbeat are ever timed out; older apps rely on `close`.
          this.heard.set(conn, now)
        } else if (msg.t === 'peek') {
          const info = this.events.onPeek()
          if (info) conn.send({ t: 'peek', info } satisfies ToGuest)
          setTimeout(() => conn.close(), 300)
        } else if (msg.t === 'hello') {
          if (this.ownToken && msg.token === this.ownToken) {
            conn.send({ t: 'closed', reason: SAME_DEVICE, kind: 'same-device' } satisfies ToGuest)
            setTimeout(() => conn.close(), 200)
            return
          }
          token = msg.token
          const old = this.conns.get(token)
          this.conns.set(token, conn)
          if (old && old !== conn) {
            this.heard.delete(old)
            old.close()
          }
          this.events.onJoin(token, msg.name.trim() || 'Гость', msg.fid)
        } else if (msg.t === 'act' && token) this.events.onAction(token, msg.action)
        else if (msg.t === 'emote' && token) this.events.onEmote(token, msg.emoji)
        else if (msg.t === 'away' && token) this.events.onAway(token, msg.on)
      })
      conn.on('close', () => {
        this.heard.delete(conn)
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
    this.lastBeat = 0
    this.heartbeat()
    if (this.peer && (this.peer.disconnected || this.peer.destroyed)) this.recover()
  }

  /** Tells the guests at once that the host put the app away, before the line itself goes quiet. */
  away(on: boolean) {
    this.broadcast({ t: 'away', on })
  }

  send(token: string, msg: ToGuest) {
    const conn = this.conns.get(token)
    if (conn?.open) conn.send(msg)
  }

  broadcast(msg: ToGuest) {
    for (const conn of this.conns.values()) if (conn.open) conn.send(msg)
  }

  /** Sends a guest away with a reason; their seat is not given back. */
  dismiss(token: string, reason: string, kind: ErrorKind) {
    this.send(token, { t: 'closed', reason, kind })
    setTimeout(() => {
      const conn = this.conns.get(token)
      if (!conn) return
      this.conns.delete(token)
      this.heard.delete(conn)
      conn.close()
    }, 200)
  }

  kick(token: string) {
    this.dismiss(token, 'Хост убрал вас из комнаты.', 'kicked')
  }

  close() {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    if (this.beat) clearInterval(this.beat)
    this.broadcast({ t: 'closed', reason: 'Хост закрыл комнату.', kind: 'closed' })
    setTimeout(() => this.peer?.destroy(), 300)
  }
}

/** Steps of getting into a room, shown as they happen. */
export type JoinStage = 'loading' | 'broker' | 'host' | 'hello'

export interface GuestEvents {
  onStage: (stage: JoinStage) => void
  /** getting into the room is taking longer than it should */
  onSlow: () => void
  onConnected: () => void
  onMessage: (msg: ToGuest) => void
  onLost: (err: RoomError) => void
  onReconnecting: (on: boolean) => void
}

/** How long a guest keeps trying to get back into the room before giving up. */
export const GUEST_PATIENCE_MS = 90_000

export class GuestRoom {
  private peer!: Peer
  private conn: DataConnection | null = null
  private done = false
  private everConnected = false
  private lostAt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private linkTimers: ReturnType<typeof setTimeout>[] = []
  private beat: ReturnType<typeof setInterval> | null = null
  /** when the host last said anything; 0 until a host that sends heartbeats is heard */
  private heard = 0
  private lastBeat = Date.now()

  constructor(
    public code: string,
    private name: string,
    private token: string,
    private fid: string,
    private events: GuestEvents,
  ) {
    if (PeerCtor) this.peer = this.makePeer()
    else {
      this.events.onStage('loading')
      loadPeer().then(
        () => {
          if (!this.done) this.peer = this.makePeer()
        },
        () => this.fail(LOAD_FAILED),
      )
    }
    this.beat = setInterval(() => this.watch(), 1000)
  }

  private fail(err: RoomError) {
    if (this.done) return
    this.done = true
    this.clearLinkTimers()
    if (this.beat) clearInterval(this.beat)
    this.events.onReconnecting(false)
    this.events.onLost(err)
  }

  /** A host gone quiet (tab closed, phone asleep, app in the background) is noticed within seconds, not never. */
  private watch() {
    const now = Date.now()
    const slept = now - this.lastBeat > 1000 + SLEPT_MS
    this.lastBeat = now
    if (this.done || !this.heard || !this.conn?.open) return
    if (slept) {
      this.heard = now
      return
    }
    if (now - this.heard > SILENCE_MS) {
      const conn = this.conn
      this.conn = null
      this.heard = 0
      conn.close()
      this.dropped()
    }
  }

  private makePeer() {
    this.events.onStage('broker')
    const peer = createPeer()
    const slow = this.everConnected ? null : setTimeout(() => {
      if (this.done || this.peer !== peer || peer.open) return
      peer.destroy()
      this.fail(BROKER_SLOW)
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
      peer.destroy()
      this.fail(describe(err))
    })
    return peer
  }

  private clearLinkTimers() {
    this.linkTimers.forEach(clearTimeout)
    this.linkTimers = []
  }

  private connect() {
    if (this.done) return
    this.conn?.close()
    if (!this.everConnected) this.events.onStage('host')
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true })
    this.conn = conn
    // The broker answered, but the direct link may never open (strict mobile NAT, busy relay): say so, then stop.
    if (!this.everConnected) {
      this.clearLinkTimers()
      this.linkTimers = [
        setTimeout(() => !conn.open && this.conn === conn && this.events.onSlow(), LINK_SLOW_MS),
        setTimeout(() => {
          if (conn.open || this.conn !== conn || this.everConnected) return
          conn.close()
          this.peer.destroy()
          this.fail(LINK_FAILED)
        }, LINK_TIMEOUT_MS),
      ]
    }
    conn.on('open', () => {
      this.clearLinkTimers()
      if (!this.everConnected) this.events.onStage('hello')
      conn.send({ t: 'hello', name: this.name, token: this.token, fid: this.fid } satisfies ToHost)
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') conn.send({ t: 'away', on: true } satisfies ToHost)
      this.everConnected = true
      this.lostAt = 0
      this.heard = 0
      this.events.onReconnecting(false)
      this.events.onConnected()
    })
    conn.on('data', (raw) => {
      if (this.conn !== conn) return
      const msg = raw as ToGuest
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'ping') {
        this.heard = Date.now()
        conn.send({ t: 'pong' } satisfies ToHost)
        return
      }
      if (this.heard) this.heard = Date.now()
      if (msg.t === 'closed') {
        this.done = true
        this.clearLinkTimers()
        if (this.beat) clearInterval(this.beat)
      }
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
    if (!this.everConnected) {
      // Never got in: there is nothing to restore.
      this.fail(LINK_FAILED)
      return
    }
    if (!this.lostAt) this.lostAt = Date.now()
    if (Date.now() - this.lostAt > GUEST_PATIENCE_MS) {
      this.fail({ message: 'Хост так и не вернулся. Связь с комнатой потеряна.', kind: 'lost' })
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

  /** When the line dropped, or 0 while it is up. */
  get lostSince() {
    return this.lostAt
  }

  /** Call when the app comes back to the foreground. */
  resume() {
    this.lastBeat = Date.now()
    if (this.heard) this.heard = Date.now()
    if (!this.done && this.everConnected && !this.conn?.open) {
      this.lostAt = this.lostAt || Date.now()
      this.dropped()
    }
  }

  /** Tells the host this app went into the background, or came back. */
  away(on: boolean) {
    if (this.conn?.open) this.conn.send({ t: 'away', on } satisfies ToHost)
  }

  /** Whether a move can go out right now. */
  get linked() {
    return !!this.conn?.open
  }

  act(action: Action): boolean {
    if (!this.conn?.open) return false
    this.conn.send({ t: 'act', action } satisfies ToHost)
    return true
  }

  emote(emoji: string) {
    if (this.conn?.open) this.conn.send({ t: 'emote', emoji } satisfies ToHost)
  }

  close() {
    this.done = true
    this.clearLinkTimers()
    if (this.retry) clearTimeout(this.retry)
    if (this.beat) clearInterval(this.beat)
    this.conn?.close()
    setTimeout(() => this.peer?.destroy(), 200)
  }
}

/**
 * Asks a room what it is (who hosts, which game, the stake) without joining it, for the invite screen.
 * Resolves to null when the room does not answer in time; that is not an error, the invite just shows less.
 */
export function peekRoom(code: string, timeoutMs = 9000): Promise<RoomPreview | null> {
  return loadPeer().then(
    () =>
      new Promise<RoomPreview | null>((resolve) => {
        let settled = false
        const peer = createPeer()
        const end = (v: RoomPreview | null) => {
          if (settled) return
          settled = true
          clearTimeout(t)
          setTimeout(() => peer.destroy(), 100)
          resolve(v)
        }
        const t = setTimeout(() => end(null), timeoutMs)
        peer.on('error', () => end(null))
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + code, { reliable: true })
          conn.on('open', () => conn.send({ t: 'peek' } satisfies ToHost))
          conn.on('data', (raw) => {
            const msg = raw as ToGuest
            if (msg && typeof msg === 'object' && msg.t === 'peek' && msg.info && typeof msg.info.host === 'string') end(msg.info)
          })
          conn.on('close', () => end(null))
        })
      }),
    () => null,
  )
}
