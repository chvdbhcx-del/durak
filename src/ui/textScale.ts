/**
 * Text size: follows the phone's own text size setting and the in-game «Крупно» switch.
 *
 * - iPhone: the system font `-apple-system-body` grows with Dynamic Type (17 px at the default size), and the
 *   interface is sized in rem, so the root font size carries the scale.
 * - Android: the WebView itself multiplies every font size by the system text size (textZoom). The interface
 *   follows on its own, up to a cap; card indices are sized by the card, so `--tz` divides the zoom back out of them.
 */
const MAX_UI = 1.3

function measure(css: string): number {
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;left:-999px;top:0;line-height:1;white-space:nowrap;${css}`
  probe.textContent = 'X'
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  const size = parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()
  return Math.max(h, size)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) && v > 0 ? v : 1))

export function applyTextScale(big: boolean) {
  const root = document.documentElement
  if (!document.body) return
  // How much the browser enlarges a 100 px font on its own (Android's text size): 1 almost everywhere else.
  const zoom = clamp(measure('font-size:100px') / 100, 0.5, 3)
  let system = 1
  try {
    if (CSS.supports('font', '-apple-system-body')) system = measure('font:-apple-system-body') / 17
  } catch {
    /* CSS.supports missing: keep 1 */
  }
  system = clamp(system, 0.9, MAX_UI)
  // Android's own zoom already grew the text: only hold it back past the cap.
  const held = zoom > MAX_UI ? MAX_UI / zoom : 1
  const scale = system * held * (big ? 1.12 : 1)
  root.style.fontSize = scale === 1 ? '' : `${(16 * scale).toFixed(2)}px`
  root.style.setProperty('--tz', zoom.toFixed(3))
  root.toggleAttribute('data-big', big)
}
