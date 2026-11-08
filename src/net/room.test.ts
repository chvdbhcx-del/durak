import { describe, expect, it } from 'vitest'
import { parseServer, parseToHost, publicLobby } from './room'

describe('parseServer', () => {
  it('reads an https address', () => {
    expect(parseServer('https://abc.trycloudflare.com')).toEqual({ host: 'abc.trycloudflare.com', port: 443, path: '/', secure: true })
  })
  it('assumes https for a bare host and keeps a port', () => {
    expect(parseServer('rooms.example.com:9000')).toEqual({ host: 'rooms.example.com', port: 9000, path: '/', secure: true })
  })
  it('reads a plain http address on the home network', () => {
    expect(parseServer('http://192.168.1.5:9000/')).toEqual({ host: '192.168.1.5', port: 9000, path: '/', secure: false })
  })
  it('falls back to the public broker when empty or unreadable', () => {
    expect(parseServer('')).toBeNull()
    expect(parseServer('   ')).toBeNull()
    expect(parseServer('ftp://x.y')).toBeNull()
  })
})

describe('publicLobby', () => {
  it('never hands device tokens to guests', () => {
    const lobby = publicLobby({ code: 'ABCDE', bots: 0, mode: 'podkidnoy', deckSize: 36, members: [{ id: 'a', token: 'secret-1', name: 'Хост', host: true, online: true }, { id: 'b', token: 'secret-2', name: 'Гость', host: false, online: true }] })
    expect(JSON.stringify(lobby)).not.toContain('secret')
    expect(lobby.members.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('parseToHost', () => {
  it('accepts well-formed messages', () => {
    expect(parseToHost({ t: 'hello', name: 'Очень длинное имя игрока', token: 'abc' })).toEqual({ t: 'hello', name: 'Очень длинное им', token: 'abc' })
    expect(parseToHost({ t: 'act', action: { type: 'defend', cardId: 'x1', pair: 0 } })).toEqual({ t: 'act', action: { type: 'defend', cardId: 'x1', pair: 0 } })
    expect(parseToHost({ t: 'act', action: { type: 'throw', cardIds: ['a', 'b'] } })).toEqual({ t: 'act', action: { type: 'throw', cardIds: ['a', 'b'] } })
    expect(parseToHost({ t: 'act', action: { type: 'take', extra: 1 } })).toEqual({ t: 'act', action: { type: 'take' } })
  })
  it('drops anything malformed', () => {
    expect(parseToHost(null)).toBeNull()
    expect(parseToHost('hello')).toBeNull()
    expect(parseToHost({ t: 'hello', name: 5, token: 'abc' })).toBeNull()
    expect(parseToHost({ t: 'hello', name: 'a' })).toBeNull()
    expect(parseToHost({ t: 'act', action: { type: 'bluff', cardId: 'x', pair: 0 } })).toBeNull()
    expect(parseToHost({ t: 'act', action: { type: 'defend', cardId: 'x', pair: -1 } })).toBeNull()
    expect(parseToHost({ t: 'act', action: { type: 'throw', cardIds: Array(20).fill('a') } })).toBeNull()
    expect(parseToHost({ t: 'emote', emoji: 'x'.repeat(100) })).toBeNull()
  })
})
