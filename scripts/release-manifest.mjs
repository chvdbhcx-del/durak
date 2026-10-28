// Writes update.json for over-the-air updates.
// minNativeBuild only moves forward when native code changed since the previous release,
// so web-only changes reach installed apps without a new APK.
// Usage: node scripts/release-manifest.mjs <version> <build> <bundleUrl> [previous update.json]
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [version, build, url, previousPath] = process.argv.slice(2)

const nativeFiles = execSync('git ls-files android ios capacitor.config.ts', { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
const hash = createHash('sha256')
for (const f of nativeFiles) hash.update(f).update(readFileSync(f))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const nativeDeps = Object.entries(pkg.dependencies).filter(([name]) => name.startsWith('@capacitor/') || name.startsWith('@capgo/'))
hash.update(JSON.stringify(nativeDeps))
const nativeHash = hash.digest('hex')

let minNativeBuild = Number(build)
if (previousPath && existsSync(previousPath)) {
  try {
    const previous = JSON.parse(readFileSync(previousPath, 'utf8'))
    if (previous.nativeHash === nativeHash) minNativeBuild = previous.minNativeBuild
  } catch {
    /* no usable previous manifest: require this build */
  }
}

writeFileSync('update.json', JSON.stringify({ version, url, minNativeBuild, nativeHash }, null, 2) + '\n')
console.log(`update.json: ${version}, minNativeBuild ${minNativeBuild}`)
