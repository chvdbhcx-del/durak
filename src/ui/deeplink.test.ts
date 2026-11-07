import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/app', () => ({ App: {} }))
vi.mock('./native', () => ({ isNative: false }))

const { appLink, inviteFromText, inviteUrl, parseInvite } = await import('./deeplink')

describe('invite links', () => {
  it('reads the shared site link', () => {
    expect(parseInvite('https://chvdbhcx-del.github.io/durak/#join-ab3cd')).toEqual({ code: 'AB3CD', server: '', noApp: false })
  })

  it('round-trips a private server and the came-back-from-app mark', () => {
    const url = inviteUrl('AB3CD', 'https://my.host:9000/x?y=1&z=2')
    expect(parseInvite(url)).toEqual({ code: 'AB3CD', server: 'https://my.host:9000/x?y=1&z=2', noApp: false })
    expect(parseInvite(`${url}&noapp=1`)?.noApp).toBe(true)
  })

  it('reads the app scheme', () => {
    expect(parseInvite('durak://join/AB3CD')).toEqual({ code: 'AB3CD', server: '' })
    expect(parseInvite('durak://join/AB3CD?s=https%3A%2F%2Fh')).toEqual({ code: 'AB3CD', server: 'https://h' })
  })

  it('ignores other links', () => {
    expect(parseInvite('https://chvdbhcx-del.github.io/durak/')).toBeNull()
    expect(parseInvite('durak://settings')).toBeNull()
  })

  it('never carries anything but the room', () => {
    expect(inviteUrl('AB3CD', '')).toBe('https://chvdbhcx-del.github.io/durak/#join-AB3CD')
  })

  it('builds an Android intent that falls back to the page', () => {
    const link = appLink({ code: 'AB3CD', server: '' }, 'android')!
    expect(link.startsWith('intent://join/AB3CD#Intent;scheme=durak;package=com.chvdbhcx.durak;')).toBe(true)
    const back = decodeURIComponent(/S\.browser_fallback_url=([^;]+)/.exec(link)![1])
    expect(parseInvite(back)?.noApp).toBe(true)
    expect(appLink({ code: 'AB3CD', server: '' }, 'ios', true)).toBe('durak://join/AB3CD')
    // no iPhone app is published yet, so the page never offers a link Safari can't open
    expect(appLink({ code: 'AB3CD', server: '' }, 'ios')).toBeNull()
    expect(appLink({ code: 'AB3CD', server: '' }, 'other')).toBeNull()
  })

  it('finds the invite in pasted text', () => {
    const msg = 'Сыграем в дурака? Код комнаты: AB3CD\nhttps://chvdbhcx-del.github.io/durak/#join-AB3CD'
    expect(inviteFromText(msg)).toEqual({ code: 'AB3CD', server: '' })
    expect(inviteFromText(`${inviteUrl('XY7QZ', 'https://h')} `)).toEqual({ code: 'XY7QZ', server: 'https://h' })
    expect(inviteFromText('Код комнаты: ab3cd')?.code).toBe('AB3CD')
    expect(inviteFromText(' ab3cd ')?.code).toBe('AB3CD')
    expect(inviteFromText('durak://join/AB3CD')?.code).toBe('AB3CD')
    expect(inviteFromText('привет, как дела')).toBeNull()
    expect(inviteFromText('')).toBeNull()
  })
})
