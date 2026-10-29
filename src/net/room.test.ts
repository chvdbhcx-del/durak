import { describe, expect, it } from 'vitest'
import { parseServer } from './room'

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
