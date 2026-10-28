import { App as NativeApp } from '@capacitor/app'
import { CapacitorHttp } from '@capacitor/core'
import { BundleInfo, CapacitorUpdater } from '@capgo/capacitor-updater'
import { isNative } from './native'

/**
 * Over-the-air updates for the native apps. Every merge to main publishes a GitHub release
 * with the web bundle; the app asks the GitHub API for the latest release, downloads a newer
 * bundle in the background and switches to it on its own: right away when nobody is mid-game,
 * otherwise on the next launch. A bundle that needs newer native code (a new plugin, say)
 * asks for a fresh APK instead, which is the one case that needs a tap.
 */

export const WEB_VERSION: string = __WEB_VERSION__
export const RELEASES_URL = 'https://github.com/chvdbhcx-del/durak/releases/latest'
const API_URL = 'https://api.github.com/repos/chvdbhcx-del/durak/releases/latest'
const CHECK_EVERY_MS = 2 * 60 * 1000

interface Release {
  tag_name: string
  body?: string
  assets: { name: string; browser_download_url: string }[]
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'downloading'; version: string }
  /** downloaded; applied when the player is out of a game */
  | { kind: 'ready'; version: string; bundle: BundleInfo }
  | { kind: 'applying'; version: string }
  | { kind: 'needs-app'; version: string }

/** What the last check found, shown under the version in the menu so problems are visible. */
export interface UpdateLog {
  at: number
  text: string
}
let log: UpdateLog | null = null
const logWatchers = new Set<(l: UpdateLog | null) => void>()
function note(text: string) {
  log = { at: Date.now(), text }
  for (const w of logWatchers) w(log)
}
export function watchUpdateLog(fn: (l: UpdateLog | null) => void) {
  logWatchers.add(fn)
  fn(log)
  return () => {
    logWatchers.delete(fn)
  }
}

function newer(a: string, b: string) {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

/** Native HTTP first (no CORS, follows GitHub's redirects); the WebView's fetch as a fallback. */
async function getJson<T>(url: string): Promise<T> {
  try {
    const res = await CapacitorHttp.get({ url, headers: { Accept: 'application/vnd.github+json' }, responseType: 'json', connectTimeout: 15000, readTimeout: 15000 })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T
  } catch (nativeErr) {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} (native: ${String(nativeErr)})`)
    return (await res.json()) as T
  }
}

async function runningVersion() {
  const current = (await CapacitorUpdater.current()).bundle
  return current.version && current.version !== 'builtin' ? current.version : WEB_VERSION
}

let lastCheck = 0
let busy = false
let ready: { version: string; bundle: BundleInfo } | null = null
let inGame: () => boolean = () => false
let emit: (s: UpdateState) => void = () => {}

async function check() {
  if (busy || Date.now() - lastCheck < CHECK_EVERY_MS) return
  busy = true
  lastCheck = Date.now()
  try {
    const release = await getJson<Release>(API_URL)
    const version = release.tag_name.replace(/^v/, '')
    const running = await runningVersion()
    if (!newer(version, running)) {
      note(`Проверено, у вас последняя версия`)
      return
    }
    if (ready?.version === version) return applyIfIdle()

    // The release notes carry the oldest APK this bundle still runs on.
    const minNativeBuild = Number(/minNativeBuild:\s*(\d+)/.exec(release.body ?? '')?.[1] ?? 0)
    const build = parseInt((await NativeApp.getInfo()).build, 10) || 0
    if (build < minNativeBuild) {
      note(`Версия ${version} требует новое приложение`)
      return emit({ kind: 'needs-app', version })
    }

    const zip = release.assets.find((a) => a.name.endsWith('.zip'))
    if (!zip) throw new Error('в релизе нет веб-сборки')
    emit({ kind: 'downloading', version })
    note(`Скачиваем версию ${version}…`)
    const checksum = /sha256:\s*([0-9a-f]{64})/i.exec(release.body ?? '')?.[1]?.toLowerCase()
    if (!checksum) throw new Error('в релизе нет контрольной суммы')
    const bundle = await CapacitorUpdater.download({ url: zip.browser_download_url, version, checksum })
    await CapacitorUpdater.next({ id: bundle.id })
    // Otherwise the updater would swap bundles the moment the app goes to the background, mid-game included.
    await CapacitorUpdater.setMultiDelay({ delayConditions: [{ kind: 'kill' }] })
    ready = { version, bundle }
    note(`Версия ${version} скачана`)
    emit({ kind: 'ready', version, bundle })
    applyIfIdle()
  } catch (err) {
    note(`Не удалось проверить обновление: ${err instanceof Error ? err.message : String(err)}`)
    emit({ kind: 'idle' })
  } finally {
    busy = false
  }
}

/** Switches to the downloaded bundle unless a game is in progress. */
export function applyIfIdle() {
  if (!ready || inGame()) return
  const { version, bundle } = ready
  ready = null
  emit({ kind: 'applying', version })
  // A beat so the "updating" toast is seen before the reload.
  setTimeout(() => CapacitorUpdater.set({ id: bundle.id }).catch(() => emit({ kind: 'ready', version, bundle })), 900)
}

/** A bundle downloaded last session goes live at launch, before anyone is mid-game. */
async function applyPendingOnLaunch() {
  const [next, current] = await Promise.all([CapacitorUpdater.getNextBundle(), CapacitorUpdater.current()])
  if (next && next.id !== current.bundle.id && next.status !== 'error' && newer(next.version, await runningVersion())) await CapacitorUpdater.set({ id: next.id })
}

export function startUpdates(onState: (s: UpdateState) => void, busyNow: () => boolean) {
  if (!isNative) return () => {}
  emit = onState
  inGame = busyNow
  // Tell the updater this bundle booted fine, otherwise it rolls back to the previous one.
  CapacitorUpdater.notifyAppReady()
    .then(applyPendingOnLaunch)
    .catch(() => {})
  check()
  const sub = NativeApp.addListener('appStateChange', ({ isActive }) => isActive && check())
  return () => {
    sub.then((s) => s.remove()).catch(() => {})
  }
}

export function applyNow(bundle: BundleInfo) {
  ready = null
  CapacitorUpdater.set({ id: bundle.id }).catch(() => {})
}
