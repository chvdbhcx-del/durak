import { useCallback, useEffect, useRef, useState } from 'react'
import { type Friend, friendId, Inbox, type InboxMsg, loadFriends, saveFriends } from './friends'

export type Incoming = { id: number; kind: 'invite'; fid: string; name: string; code: string; server?: string } | { id: number; kind: 'friend'; fid: string; name: string }

export interface Friends {
  fid: string
  list: Friend[]
  /** friend id → app is open right now; filled by `refresh` */
  here: Record<string, boolean>
  incoming: Incoming | null
  /** a short confirmation line, e.g. "Приглашение отправлено" */
  flash: string | null
  add: (fid: string, name: string) => void
  remove: (fid: string) => void
  isFriend: (fid: string | undefined) => boolean
  refresh: () => void
  invite: (fid: string, code: string, server: string) => Promise<boolean>
  dismiss: () => void
  say: (text: string) => void
}

/** Friend list plus the always-on inbox that receives invitations and friend requests. */
export function useFriends(name: string, server: string): Friends {
  const [fid] = useState(friendId)
  const [list, setList] = useState<Friend[]>(loadFriends)
  const [here, setHere] = useState<Record<string, boolean>>({})
  const [queue, setQueue] = useState<Incoming[]>([])
  const [flash, setFlash] = useState<string | null>(null)
  const inbox = useRef<Inbox | null>(null)
  const listRef = useRef(list)
  listRef.current = list
  const nameRef = useRef(name)
  nameRef.current = name
  const seq = useRef(0)

  const say = useCallback((text: string) => {
    setFlash(text)
    setTimeout(() => setFlash((f) => (f === text ? null : f)), 2600)
  }, [])

  const update = (next: Friend[]) => {
    saveFriends(next)
    setList(next)
  }

  useEffect(() => {
    const handle = (msg: InboxMsg) => {
      if (msg.t === 'ping' || msg.fid === fid) return
      const known = listRef.current.find((f) => f.id === msg.fid)
      if (msg.t === 'friend') {
        if (known) {
          if (known.name !== msg.name) update(listRef.current.map((f) => (f.id === msg.fid ? { ...f, name: msg.name } : f)))
          return
        }
        setQueue((q) => (q.some((i) => i.fid === msg.fid && i.kind === 'friend') ? q : [...q, { id: ++seq.current, kind: 'friend', fid: msg.fid, name: msg.name }]))
      } else if (known) {
        // Only friends can invite: a stranger who learned the id gets nowhere.
        setQueue((q) => [...q.filter((i) => !(i.kind === 'invite' && i.fid === msg.fid)), { id: ++seq.current, kind: 'invite', fid: msg.fid, name: known.name, code: msg.code, server: msg.server }])
      }
    }
    const box = new Inbox(fid, handle)
    inbox.current = box
    const onShow = () => document.visibilityState === 'visible' && box.resume()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      box.close()
      if (inbox.current === box) inbox.current = null
    }
  }, [fid, server])

  const add = useCallback(
    (id: string, friendName: string) => {
      if (id === fid || listRef.current.some((f) => f.id === id)) return
      update([...listRef.current, { id, name: friendName }])
      // Let them know, so they can add us back and invitations work both ways.
      inbox.current?.send(id, { t: 'friend', fid, name: nameRef.current.trim().slice(0, 16) || 'Игрок' })
      say(`${friendName} в друзьях`)
    },
    [fid, say],
  )

  const remove = useCallback((id: string) => update(listRef.current.filter((f) => f.id !== id)), [])

  const refresh = useCallback(() => {
    for (const f of listRef.current) inbox.current?.ping(f.id).then((ok) => setHere((h) => (h[f.id] === ok ? h : { ...h, [f.id]: ok })))
  }, [])

  const invite = useCallback(async (id: string, code: string, srv: string) => {
    const ok = (await inbox.current?.send(id, { t: 'invite', fid, name: nameRef.current.trim().slice(0, 16) || 'Игрок', code, server: srv.trim() || undefined })) ?? false
    setHere((h) => ({ ...h, [id]: ok }))
    return ok
  }, [fid])

  return {
    fid,
    list,
    here,
    incoming: queue[0] ?? null,
    flash,
    add,
    remove,
    isFriend: (id) => !!id && list.some((f) => f.id === id),
    refresh,
    invite,
    dismiss: () => setQueue((q) => q.slice(1)),
    say,
  }
}
