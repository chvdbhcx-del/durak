import { App as NativeApp } from '@capacitor/app'
import { useEffect, useRef } from 'react'
import { isNative } from './native'

/**
 * One "back" for the whole app: Android's back button or gesture, the browser's back button and
 * a swipe from the left edge all land here. Handlers are asked from the newest down; the first
 * that returns true has taken the step (an open sheet closes, a screen goes up a level, the table
 * opens its pause menu). When nobody takes it, the root decides (a second press leaves the app).
 */
type Handler = () => boolean
const stack: { fn: Handler }[] = []
let root: () => void = () => {}

export function dispatchBack() {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].fn()) return
  root()
}

/** Registers a back step while the component is mounted; `fn` may change between renders. */
export function useBack(fn: Handler) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const entry = { fn: () => ref.current() }
    stack.push(entry)
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [])
}

/**
 * Wires the system back to `dispatchBack`. `atRoot` says the main menu is showing with nothing
 * open: there the browser's own back leaves the site, and on a phone a second press within 2 s
 * closes the app (`onExitHint` shows the hint after the first one).
 */
export function useSystemBack(atRoot: boolean, onExitHint: () => void, edgeSwipe: boolean) {
  const hint = useRef(onExitHint)
  hint.current = onExitHint
  const rootRef = useRef(atRoot)
  rootRef.current = atRoot

  useEffect(() => {
    let armed = 0
    root = () => {
      if (!isNative) return
      if (Date.now() - armed < 2000) {
        NativeApp.exitApp().catch(() => {})
        return
      }
      armed = Date.now()
      hint.current()
    }
    if (!isNative) return
    const sub = NativeApp.addListener('backButton', () => dispatchBack())
    return () => {
      sub.then((s) => s.remove()).catch(() => {})
    }
  }, [])

  // The browser: one extra history entry stands guard while anything sits above the main menu,
  // so its back button steps inside the game instead of leaving the site.
  useEffect(() => {
    if (isNative) return
    const onPop = () => {
      if (ignorePop) {
        ignorePop = false
        return
      }
      guarded = false
      dispatchBack()
      // the step above may have reached the main menu; if not, the guard goes back up
      setTimeout(() => {
        if (!rootRef.current) guard()
      }, 0)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (isNative) return
    if (!atRoot) guard()
    else if (guarded) {
      // back at the menu by a button on screen: the guard is taken down so the next back leaves
      guarded = false
      ignorePop = true
      history.back()
    }
  }, [atRoot])

  // iPhone has no system back: a swipe from the left edge does the same, outside the table.
  const edge = useRef(edgeSwipe)
  edge.current = edgeSwipe
  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null
    const down = (e: TouchEvent) => {
      const t = e.touches[0]
      start = e.touches.length === 1 && t.clientX < 24 && edge.current ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
    }
    const up = (e: TouchEvent) => {
      const s = start
      start = null
      const t = e.changedTouches[0]
      if (!s || !t) return
      const dx = t.clientX - s.x
      const dy = Math.abs(t.clientY - s.y)
      if (dx > 70 && dy < dx * 0.6 && Date.now() - s.t < 700) dispatchBack()
    }
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchend', up, { passive: true })
    return () => {
      window.removeEventListener('touchstart', down)
      window.removeEventListener('touchend', up)
    }
  }, [])
}

let guarded = false
let ignorePop = false
function guard() {
  if (guarded) return
  guarded = true
  history.pushState({ durakBack: true }, '')
}
