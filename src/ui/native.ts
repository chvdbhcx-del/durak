import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'

export const isNative = Capacitor.isNativePlatform()

// Haptics fall back to navigator.vibrate on the web and are silently ignored where unsupported.
export function tap(strength: 'light' | 'medium' = 'light') {
  Haptics.impact({ style: strength === 'light' ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {})
}

export function notify(kind: 'success' | 'warning') {
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
