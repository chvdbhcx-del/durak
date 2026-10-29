import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'

export const isNative = Capacitor.isNativePlatform()

let hapticsOn = true
export function setHaptics(on: boolean) {
  hapticsOn = on
}

// Haptics fall back to navigator.vibrate on the web and are silently ignored where unsupported.
// Android's stock impact buzz is long and heavy, so it gets a short plain vibration instead.
const android = Capacitor.getPlatform() === 'android'

export function tap(strength: 'light' | 'medium' = 'light') {
  if (!hapticsOn) return
  if (android) {
    Haptics.vibrate({ duration: strength === 'light' ? 6 : 12 }).catch(() => {})
    return
  }
  Haptics.impact({ style: strength === 'light' ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {})
}

export function notify(kind: 'success' | 'warning') {
  if (!hapticsOn) return
  if (android) {
    Haptics.vibrate({ duration: kind === 'success' ? 14 : 22 }).catch(() => {})
    return
  }
  Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Warning }).catch(() => {})
}

/** Keeps the phone's status bar readable against the current theme. */
export function syncStatusBar() {
  if (!isNative) return
  const bg = getComputedStyle(document.body).backgroundColor
  const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark')
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  if (Capacitor.getPlatform() === 'android') {
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
    const rgb = bg.match(/\d+/g)?.slice(0, 3).map(Number) ?? [13, 17, 18]
    StatusBar.setBackgroundColor({ color: '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('') }).catch(() => {})
  }
}
