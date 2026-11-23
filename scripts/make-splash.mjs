// Regenerates the launch screens (Android, iOS) and the iPhone web startup images from assets/icon-foreground.svg:
// the card fan without its square backing, about a third of the screen wide, with the word «Дурак» under it,
// on the app's own background, light and dark, so the app opens in the colours it is about to show.
// Run: npm run icons  (needs Playwright with Chromium)
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const root = new URL('..', import.meta.url).pathname
const fan = readFileSync(join(root, 'assets', 'icon-foreground.svg'), 'utf8')
const font = readFileSync(require.resolve('@fontsource/unbounded/files/unbounded-cyrillic-800-normal.woff2')).toString('base64')

const THEMES = {
  dark: { bg: '#0d1112', fg: '#e6ebe8' },
  light: { bg: '#e8ece9', fg: '#16201d' },
}

const browser = await chromium.launch()
const page = await browser.newPage()

/** `logo` is the fan's width in px; the word sits under it. */
async function render(w, h, logo, theme, out) {
  const t = THEMES[theme]
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: U; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 800; }
    html, body { margin: 0; width: ${w}px; height: ${h}px; background: ${t.bg}; }
    body { display: grid; place-items: center; }
    .stack { display: grid; justify-items: center; gap: ${Math.round(logo * 0.02)}px; margin-top: ${Math.round(-logo * 0.1)}px; }
    svg { width: ${logo}px; height: ${logo}px; display: block; }
    b { font: 800 ${Math.round(logo * 0.24)}px/1 U, sans-serif; color: ${t.fg}; letter-spacing: 0.01em; margin-top: ${Math.round(-logo * 0.16)}px; }
  </style></head><body><div class="stack">${fan}<b>Дурак</b></div></body></html>`)
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(dirname(join(root, out)), { recursive: true })
  writeFileSync(join(root, out), await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }))
}

// Android: the launch window's background, per density and orientation. Plain folders are light, -night dark.
const res = 'android/app/src/main/res'
const sizes = { ldpi: [240, 320], mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] }
for (const [d, [w, h]] of Object.entries(sizes)) {
  for (const [night, theme] of [['', 'light'], ['-night', 'dark']]) {
    await render(w, h, Math.round(w * 0.42), theme, `${res}/drawable-port${night}-${d}/splash.png`)
    await render(h, w, Math.round(w * 0.42), theme, `${res}/drawable-land${night}-${d}/splash.png`)
  }
}
await render(320, 480, 134, 'light', `${res}/drawable/splash.png`)
await render(320, 480, 134, 'dark', `${res}/drawable-night/splash.png`)

// iOS: one square image, cropped to the screen (aspect fill): on a phone about 1260 px of its width shows.
const ios = 'ios/App/App/Assets.xcassets/Splash.imageset'
for (const s of ['1x', '2x', '3x']) {
  await render(2732, 2732, 520, 'light', `${ios}/Default@${s}~universal~anyany.png`)
  await render(2732, 2732, 520, 'dark', `${ios}/Default@${s}~universal~anyany-dark.png`)
}

// iPhone home-screen site: startup images, or it opens on a white screen.
for (const [w, h, dpr] of [[390, 844, 3], [430, 932, 3], [375, 667, 2], [414, 896, 2]]) {
  for (const theme of ['light', 'dark']) await render(w * dpr, h * dpr, Math.round(w * dpr * 0.42), theme, `public/splash/${w}x${h}-${theme}.png`)
}

await browser.close()
console.log('splash screens written')
