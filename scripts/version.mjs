// The game's version, the same for the site, the APK and over-the-air bundles.
// 1.1.0 is commit 8856a81 (the 20th on main); every commit on main after it bumps the patch.
// Kept in one place so the release and the site can never disagree.
import { execSync } from 'node:child_process'

const commits = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim())
console.log(`1.1.${commits - 19}`)
