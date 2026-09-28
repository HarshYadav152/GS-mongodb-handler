// Signed, stateless session tokens for the single-operator login gate.
// Uses Web Crypto (crypto.subtle) so this works in both the Node.js and
// Edge middleware runtimes without extra dependencies.

export const SESSION_COOKIE = 'gs_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) {
    throw new Error(
      `${name} is not set. Set it in .env.local (see README) — the app refuses to run with an insecure default.`
    )
  }
  return v
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let str = ''
  for (const b of arr) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = requireEnv('AUTH_SECRET')
  const enc = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** Create a signed session token: base64url(payload) + "." + base64url(signature) */
export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })
  const payloadB64 = b64url(new TextEncoder().encode(payload))
  const key = await hmacKey()
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  return `${payloadB64}.${b64url(sig)}`
}

/** Verify a session token's signature and expiry. Never throws — returns boolean. */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sigB64] = parts
  try {
    const key = await hmacKey()
    const sig = b64urlDecode(sigB64).slice() // guarantees ArrayBuffer-backed (not ArrayBufferLike) for TS's BufferSource
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payloadB64))
    if (!valid) return false
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as { exp: number }
    return typeof payload.exp === 'number' && Date.now() < payload.exp
  } catch {
    return false
  }
}

/** Constant-time string compare (for the login password check). */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const aBuf = enc.encode(a)
  const bBuf = enc.encode(b)
  // Hash both first so comparison length doesn't itself leak length info,
  // then compare digests with a constant-time loop.
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', aBuf),
    crypto.subtle.digest('SHA-256', bBuf),
  ])
  const aArr = new Uint8Array(aHash)
  const bArr = new Uint8Array(bHash)
  let diff = 0
  for (let i = 0; i < aArr.length; i++) diff |= aArr[i] ^ bArr[i]
  return diff === 0
}

export function requireAppPassword(): string {
  return requireEnv('APP_PASSWORD')
}
