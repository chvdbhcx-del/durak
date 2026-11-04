// Regenerates every app icon (Android, iOS, PWA) from assets/icon*.svg.
// Run: npm run icons  (needs Playwright with Chromium; outside a project install, set NODE_PATH=$(npm root -g))
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const svg = (name) => readFileSync(join(root, 'assets', name), 'utf8');
const full = svg('icon.svg');
const fg = svg('icon-foreground.svg');
const bg = svg('icon-background.svg');

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(src, size, out, { round = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;overflow:hidden;${round ? 'border-radius:50%;' : ''}">
    ${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(join(root, out), png);
}

// Android: legacy (48dp) + adaptive layers (108dp, shown through a 72dp inset in mipmap-anydpi-v26).
const dens = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = `android/app/src/main/res/mipmap-${d}`;
  await render(full, Math.round(48 * k), `${dir}/ic_launcher.png`);
  await render(full, Math.round(48 * k), `${dir}/ic_launcher_round.png`, { round: true });
  await render(fg, Math.round(108 * k), `${dir}/ic_launcher_foreground.png`);
  await render(bg, Math.round(108 * k), `${dir}/ic_launcher_background.png`);
}

// iOS: one 1024 image, must be opaque (iOS rounds the corners itself).
await render(full, 1024, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
await render(full, 1024, 'assets/icon-only.png');

// Web / PWA.
await render(full, 192, 'public/icon-192.png');
await render(full, 512, 'public/icon-512.png');
await render(full, 180, 'public/apple-touch-icon.png');

await browser.close();
console.log('icons written');
