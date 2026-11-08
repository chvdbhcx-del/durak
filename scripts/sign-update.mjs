// Signs update.json for over-the-air updates: apps only install a bundle whose version and sha256
// carry this signature, so whoever gets hold of the repo or a release can't push code to phones.
// Usage: node scripts/sign-update.mjs <private key PEM file>   (P-256 key, alias "ota" in the release keystore)
import { sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const keyPath = process.argv[2]
const manifest = JSON.parse(readFileSync('update.json', 'utf8'))
if (!manifest.sha256) throw new Error('update.json has no sha256 to sign')
const message = `${manifest.version}\n${manifest.sha256}`
const sig = sign('sha256', Buffer.from(message), { key: readFileSync(keyPath, 'utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64')
writeFileSync('update.json', JSON.stringify({ ...manifest, sig }, null, 2) + '\n')
console.log('update.json signed')
