import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyUpdate } from './otaKey'

describe('signed updates', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const sha = 'a'.repeat(64)
  // the same call scripts/sign-update.mjs makes in the release workflow
  const sig = sign('sha256', Buffer.from(`1.1.30\n${sha}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')

  it('accepts a bundle signed by the release key', async () => {
    expect(await verifyUpdate(spki, '1.1.30', sha, sig)).toBe(true)
  })
  it('refuses a changed version or checksum, a missing or foreign signature', async () => {
    expect(await verifyUpdate(spki, '1.1.31', sha, sig)).toBe(false)
    expect(await verifyUpdate(spki, '1.1.30', 'b'.repeat(64), sig)).toBe(false)
    expect(await verifyUpdate(spki, '1.1.30', sha, undefined)).toBe(false)
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    const forged = sign('sha256', Buffer.from(`1.1.30\n${sha}`), { key: other, dsaEncoding: 'ieee-p1363' }).toString('base64')
    expect(await verifyUpdate(spki, '1.1.30', sha, forged)).toBe(false)
  })
})
