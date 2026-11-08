/**
 * Public half of the key that signs over-the-air updates (SPKI, base64). The private half lives only
 * in the release keystore (alias "ota") in the repository's secrets. Empty: updates are checked by
 * sha256 only, as before the key existed.
 */
export const OTA_PUBLIC_KEY = ''

/** Checks the release key's signature over "<version>\n<sha256>", as scripts/sign-update.mjs makes it. */
export async function verifyUpdate(publicKey: string, version: string, sha256: string, sig: string | undefined): Promise<boolean> {
  if (!sig) return false
  try {
    const raw = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const key = await crypto.subtle.importKey('spki', raw(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw(sig), new TextEncoder().encode(`${version}\n${sha256}`))
  } catch {
    return false
  }
}
