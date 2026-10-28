import { App as NativeApp } from '@capacitor/app'
import { CapacitorHttp } from '@capacitor/core'
import { BundleInfo, CapacitorUpdater } from '@capgo/capacitor-updater'
import { isNative } from './native'

/**
 * Over-the-air updates for the native apps. Every merge to main publishes a GitHub release
 * with the web bundle and an update.json manifest; the app downloads newer bundles in the
 * background and switches to them on the next restart, or right away when the player agrees.
 * A bundle that needs newer native code (a new plugin, say) asks for a fresh APK instead.
 */

export const WEB_VERSION: string = __WEB_VERSION__
export const RELEASES_URL = 'https://github.com/chvdbhcx-del/durak/releases/latest'
const MANIFEST_URL = `${RELEASES_URL}/download/update.json`
const CHECK_EVERY_MS = 30 * 60 * 1000

interface Manifest {
  version: string
  url: string
  minNativeBuild: number
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string; bundle: BundleInfo }
  | { kind: 'needs-app'; version: string }

function newer(a: string, b: string) {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

let lastCheck = 0
let busy = false

async function check(onState: (s: UpdateState) => void) {
  if (busy || Date.now() - lastCheck < CHECK_EVERY_MS) return
  busy = true
  lastCheck = Date.now()
  try {
    // Native HTTP follows GitHub's redirect to the asset and isn't subject to CORS.
    const res = await CapacitorHttp.get({ url: MANIFEST_URL, headers: { Accept: 'application/json' } })
    if (res.status !== 200) return
    const manifest: Manifest = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
    const current = (await CapacitorUpdater.current()).bundle
    const running = current.version && current.version !== 'builtin' ? current.version : WEB_VERSION
    if (!newer(manifest.version, running)) return

    const build = parseInt((await NativeApp.getInfo()).build, 10) || 0
    if (build < manifest.minNativeBuild) return onState({ kind: 'needs-app', version: manifest.version })

    onState({ kind: 'downloading', version: manifest.version })
    const bundle = await CapacitorUpdater.download({ url: manifest.url, version: manifest.version })
    await CapacitorUpdater.next({ id: bundle.id })
    onState({ kind: 'ready', version: manifest.version, bundle })
  } catch {
    onState({ kind: 'idle' })
  } finally {
    busy = false
  }
}

export function startUpdates(onState: (s: UpdateState) => void) {
  if (!isNative) return () => {}
  // Tell the updater this bundle booted fine, otherwise it rolls back to the previous one.
  CapacitorUpdater.notifyAppReady().catch(() => {})
  check(onState)
  const sub = NativeApp.addListener('appStateChange', ({ isActive }) => isActive && check(onState))
  return () => {
    sub.then((s) => s.remove()).catch(() => {})
  }
}

export function applyNow(bundle: BundleInfo) {
  CapacitorUpdater.set({ id: bundle.id }).catch(() => {})
}
