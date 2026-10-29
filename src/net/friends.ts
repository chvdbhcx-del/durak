import Peer, { type DataConnection } from 'peerjs'
import { peerOptions } from './room'

/**
 * Friends without a server. Each device keeps a public friend id and, while the app is open,
 * listens for messages on a PeerJS address made from it. Another device that knows the id can
 * knock on that address to invite the player to a room or to ask for friendship.
 */

const ID_KEY = 'durak.fid'
const FRIENDS_KEY = 'durak.friends'
const INBOX_PREFIX = 'durak-f-'

export interface Friend {
  id: string
  name: string
}

export type InboxMsg = { t: 'invite'; fid: string; name: string; code: string; server?: string } | { t: 'friend'; fid: string; name: string } | { t: 'ping' }

export function friendId(): string {
  try {
    let id = localStorage.getItem(ID_KEY)
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join('')
      localStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

export function loadFriends(): Friend[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FRIENDS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string').slice(0, 200) : []
  } catch {
    return []
  }
}

export function saveFriends(list: Friend[]) {
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: the list just won't persist */
  }
}

/** Messages come from other devices, so nothing is trusted until its shape is checked. */
export function parseInbox(raw: unknown): InboxMsg | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)
  if (m.t === 'ping') return { t: 'ping' }
  const fid = text(m.fid, 32)
  const name = text(m.name, 16)
  if (!fid || !name) return null
  if (m.t === 'friend') return { t: 'friend', fid, name }
  if (m.t === 'invite') {
    const code = text(m.code, 8)
    return code ? { t: 'invite', fid, name, code, server: text(m.server, 200) || undefined } : null
  }
  return null
}

const CONNECT_TIMEOUT_MS = 5000

export class Inbox {
  private peer: Peer | null = null
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(
    private fid: string,
    private onMessage: (msg: InboxMsg) => void,
  ) {
    this.open(0)
  }

  private open(attempt: number) {
    if (this.closed) return
    const peer = new Peer(INBOX_PREFIX + this.fid, peerOptions())
    this.peer = peer
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const msg = parseInbox(raw)
        if (msg && msg.t !== 'ping') this.onMessage(msg)
        setTimeout(() => conn.close(), 400)
      })
    })
    peer.on('error', (err) => {
      if (this.closed || this.peer !== peer) return
      if (err.type === 'peer-unavailable') return
      // Our own old registration may linger for a minute after a reload; other failures are usually the network.
      peer.destroy()
      this.later(() => this.open(attempt + 1), err.type === 'unavailable-id' ? 3000 : Math.min(30000, 4000 * (attempt + 1)))
    })
    peer.on('disconnected', () => {
      if (this.closed || this.peer !== peer || peer.destroyed) return
      this.later(() => peer.disconnected && !peer.destroyed && peer.reconnect(), 2000)
    })
  }

  private later(fn: () => void, ms: number) {
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => {
      this.retry = null
      if (!this.closed) fn()
    }, ms)
  }

  /** Call when the app returns to the foreground. */
  resume() {
    const peer = this.peer
    if (this.closed || !peer) return
    if (peer.destroyed) this.open(0)
    else if (peer.disconnected) peer.reconnect()
  }

  /** Knocks on another player's inbox. Resolves false if they are not reachable right now. */
  send(fid: string, msg: InboxMsg): Promise<boolean> {
    return new Promise((resolve) => {
      const peer = this.peer
      if (!peer || peer.destroyed || !peer.open) return resolve(false)
      let conn: DataConnection
      try {
        conn = peer.connect(INBOX_PREFIX + fid, { reliable: true })
      } catch {
        return resolve(false)
      }
      const done = (ok: boolean) => {
        clearTimeout(timer)
        setTimeout(() => conn.close(), 500)
        resolve(ok)
      }
      const timer = setTimeout(() => {
        conn.close()
        resolve(false)
      }, CONNECT_TIMEOUT_MS)
      conn.on('open', () => {
        conn.send(msg)
        done(true)
      })
      conn.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  /** Whether a friend's app is open right now. */
  ping(fid: string) {
    return this.send(fid, { t: 'ping' })
  }

  close() {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    this.peer?.destroy()
  }
}
