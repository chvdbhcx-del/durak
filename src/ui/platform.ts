import { Capacitor } from '@capacitor/core'

/** iPhone, iPad (including iPadOS posing as a Mac) or the native iOS app. */
export const isIOS =
  Capacitor.getPlatform() === 'ios' || /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * iOS Safari's toolbars grow and shrink, so `100%` / `100vh` do not match what is visible.
 * Marks the page as iOS and keeps --app-h equal to the visible height, so the table fills the
 * screen and the hand sits at the bottom.
 */
export function setupPlatform() {
  const root = document.documentElement
  if (!isIOS) return
  root.classList.add('ios')
  const apply = () => root.style.setProperty('--app-h', `${Math.round(window.visualViewport?.height ?? window.innerHeight)}px`)
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', () => setTimeout(apply, 250))
  window.visualViewport?.addEventListener('resize', apply)
}
