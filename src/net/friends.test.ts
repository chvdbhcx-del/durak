import { describe, expect, it } from 'vitest'
import { parseInbox } from './friends'

describe('parseInbox', () => {
  it('accepts an invite and a friend request', () => {
    expect(parseInbox({ t: 'invite', fid: 'abc', name: 'Аня', code: 'AB3CD' })).toEqual({ t: 'invite', fid: 'abc', name: 'Аня', code: 'AB3CD', server: undefined })
    expect(parseInbox({ t: 'friend', fid: 'abc', name: 'Аня' })).toEqual({ t: 'friend', fid: 'abc', name: 'Аня' })
  })
  it('keeps a private server address from an invite', () => {
    expect(parseInbox({ t: 'invite', fid: 'a', name: 'B', code: 'AB3CD', server: 'https://x.example.com' })?.t).toBe('invite')
  })
  it('drops anything malformed', () => {
    expect(parseInbox(null)).toBeNull()
    expect(parseInbox('hi')).toBeNull()
    expect(parseInbox({ t: 'invite', fid: 'a', name: 'B' })).toBeNull()
    expect(parseInbox({ t: 'friend', name: 'B' })).toBeNull()
    expect(parseInbox({ t: 'boom', fid: 'a', name: 'B' })).toBeNull()
  })
  it('cuts overlong text', () => {
    const m = parseInbox({ t: 'friend', fid: 'a', name: 'x'.repeat(100) })
    expect(m && 'name' in m && m.name.length).toBe(16)
  })
})
