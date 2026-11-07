import { App as NativeApp } from '@capacitor/app'
import { normalizeCode } from '../net/room'
import { isNative } from './native'

/**
 * Invite links. A shared link is always the website (…/durak/#join-CODE), because that is the only
 * thing every phone can open. From there:
 * - the Android app claims durak://join/CODE and the site's own https links, verified through
 *   assetlinks.json at the domain root (the chvdbhcx-del.github.io repository, see site-root/);
 * - the iPhone app claims durak://join/CODE (universal links need a file at the domain root and a
 *   signed app, neither of which a github.io project site can have);
 * - a home-screen web app catches the link where the platform lets it (Android Chrome installs it as
 *   a WebAPK that owns its scope; desktop Chrome/Edge via launch_handler); iOS never hands links to one;
 * - everywhere else the site shows "Открыть в приложении" before letting the person play in the browser.
 * The link names only the room (and a private room server, if one is used): never the sender's
 * profile, so whoever opens it plays as themselves on their own device.
 */

export const SITE_URL = 'https://chvdbhcx-del.github.io/durak/'
export const APP_SCHEME = 'durak'
const ANDROID_PACKAGE = 'com.chvdbhcx.durak'

export interface Invite {
  code: string
  server: string
  /** set when the browser already tried the app and came back, so the page stops offering it */
  noApp?: boolean
}

function decode(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return '' // a mangled link just falls back to the public server
  }
}

/** Reads an invite from any link shape we hand out: https://…/durak/#join-CODE&s=…, durak://join/CODE?s=… */
export function parseInvite(url: string): Invite | null {
  const hash = /#join-([A-Za-z0-9]+)((?:&[^#]*)?)$/.exec(url)
  if (hash) {
    const s = /&s=([^&]*)/.exec(hash[2])
    const code = normalizeCode(hash[1])
    return code ? { code, server: decode(s?.[1]), noApp: /&noapp=1/.test(hash[2]) } : null
  }
  const scheme = new RegExp(`^${APP_SCHEME}://join/([A-Za-z0-9]+)(?:\\?(.*))?$`).exec(url)
  if (scheme) {
    const params = new URLSearchParams(scheme[2] ?? '')
    const code = normalizeCode(scheme[1])
    return code ? { code, server: params.get('s') ?? '' } : null
  }
  return null
}

/**
 * Finds an invite in pasted text: the shared message ("…Код комнаты: AB3CD" plus the link), a bare
 * link, or just the five letters. Used where a link can't reach the game by itself (a site on the
 * iPhone home screen), so the person copies the invite in the messenger and pastes it in the game.
 */
export function inviteFromText(text: string): Invite | null {
  const t = text.trim()
  const link = /\S*#join-[A-Za-z0-9]+(?:&[^\s#]*)?/.exec(t) ?? new RegExp(`${APP_SCHEME}://join/\\S+`).exec(t)
  if (link) {
    const inv = parseInvite(link[0])
    if (inv) return { code: inv.code, server: inv.server }
  }
  const labelled = /код[^:]*:\s*([A-Za-z0-9]{5})\b/i.exec(t)
  const bare = /^[A-Za-z0-9]{5}$/.test(t) ? t : labelled?.[1]
  const code = bare ? normalizeCode(bare) : ''
  return code.length === 5 ? { code, server: '' } : null
}

/** The link people share. */
export function inviteUrl(code: string, server: string): string {
  return `${SITE_URL}#join-${code}${server.trim() ? `&s=${encodeURIComponent(server.trim())}` : ''}`
}

export type WebPlatform = 'android' | 'ios' | 'other'

export function webPlatform(): WebPlatform {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  // iPadOS reports itself as a Mac with touch.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return 'other'
}

/** True in an ordinary browser tab, not in the native app or a site opened from the home screen. */
export function inBrowserTab(): boolean {
  if (isNative) return false
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone) return false
  try {
    return !window.matchMedia('(display-mode: standalone)').matches && !window.matchMedia('(display-mode: fullscreen)').matches
  } catch {
    return true
  }
}

/** True on an iPhone/iPad site opened from the home screen: the one place a link never reaches. */
export function iosHomeScreen(): boolean {
  return !isNative && webPlatform() === 'ios' && !inBrowserTab()
}

/**
 * There is no iPhone app to hand a link to yet (it needs a signed build), and a durak:// link with
 * nothing to open it only shows Safari's "address is invalid". Turn on once the app is in the App Store.
 */
export const IOS_APP_PUBLISHED = false

/**
 * A link that opens the installed app straight in the room. On Android it is an intent:// link, so
 * Chrome opens the app if it is there and otherwise comes back to this page marked noapp; on iOS a
 * plain durak:// link, only once there is an iPhone app (see IOS_APP_PUBLISHED).
 */
export function appLink(invite: Invite, platform: WebPlatform = webPlatform(), iosApp = IOS_APP_PUBLISHED): string | null {
  const query = invite.server ? `?s=${encodeURIComponent(invite.server)}` : ''
  const path = `join/${invite.code}${query}`
  if (platform === 'android') {
    const back = `${inviteUrl(invite.code, invite.server)}&noapp=1`
    return `intent://${path}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(back)};end`
  }
  if (platform === 'ios' && iosApp) return `${APP_SCHEME}://${path}`
  return null
}

/**
 * Calls back with every invite that reaches an already running page: the native app opened from a
 * link (cold start included), a home-screen web app re-targeted by launch_handler, or the hash
 * changing in an open tab. Returns a cleanup.
 */
export function watchInvites(onInvite: (invite: Invite) => void): () => void {
  const offs: (() => void)[] = []
  if (isNative) {
    let gone = false
    const handle = (url: string | undefined) => {
      const inv = url ? parseInvite(url) : null
      if (inv && !gone) onInvite(inv)
    }
    NativeApp.getLaunchUrl()
      .then((r) => handle(r?.url))
      .catch(() => {})
    const sub = NativeApp.addListener('appUrlOpen', (e) => handle(e.url))
    offs.push(() => {
      gone = true
      sub.then((s) => s.remove()).catch(() => {})
    })
  } else {
    const onHash = () => {
      const inv = parseInvite(window.location.href)
      if (inv) onInvite(inv)
    }
    window.addEventListener('hashchange', onHash)
    offs.push(() => window.removeEventListener('hashchange', onHash))
    const lq = (window as Window & { launchQueue?: { setConsumer: (fn: (p: { targetURL?: string }) => void) => void } }).launchQueue
    try {
      lq?.setConsumer((p) => {
        const inv = p.targetURL ? parseInvite(p.targetURL) : null
        if (inv) onInvite(inv)
      })
    } catch {
      /* not supported */
    }
  }
  return () => offs.forEach((f) => f())
}
