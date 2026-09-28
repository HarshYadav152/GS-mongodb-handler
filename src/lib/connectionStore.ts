import 'server-only'
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { maskUri } from './mask'
import { validateUri } from './mongodb'
import { AppError } from './errors'

// ── Saved-connection storage, server-side only ────────────────────────────
//
// Fixes two problems from the original design:
//  1. The AES key used to previously never leaves the browser bundle (it's
//     never sent to the client at all — only masked URIs and opaque IDs are).
//  2. The raw MongoDB URI (with credentials) is no longer stored in the
//     browser's localStorage — the client only ever holds a connection ID.
//
// Persistence here is a small local JSON file, which is enough for a
// single-operator/self-hosted deployment of this tool. If you deploy this
// on a platform with an ephemeral/read-only filesystem (e.g. most
// serverless platforms), point CONNECTIONS_STORE_PATH at a persistent
// volume, or swap this module for a real datastore — the encrypt/decrypt
// functions below don't need to change.

interface StoredConnection {
  id: string
  name: string
  cipher: string // iv:authTag:ciphertext, all base64
  createdAt: string
  lastUsed?: string
}

export interface PublicConnection {
  id: string
  name: string
  maskedUri: string
  createdAt: string
  lastUsed?: string
}

const STORE_PATH = process.env.CONNECTIONS_STORE_PATH || '.data/connections.json'

// Static, non-secret salt for scrypt. The secrecy comes entirely from
// ENCRYPTION_SECRET; the salt just needs to be present (defends against
// precomputed-table attacks), it doesn't need to be random per-install.
const KDF_SALT = 'gs-mongodb-handler-kdf-salt-v1'

function requireSecret(): string {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret || !secret.trim()) {
    throw new AppError(
      'Server misconfiguration: ENCRYPTION_SECRET is not set. Refusing to store connections insecurely — set it in .env.local.',
      500
    )
  }
  return secret
}

function key(): Buffer {
  return scryptSync(requireSecret(), KDF_SALT, 32)
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${enc.toString('base64')}`
}

function decrypt(cipherStr: string): string {
  const [ivB64, tagB64, dataB64] = cipherStr.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new AppError('Stored connection is corrupted', 500)
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

// ── naive read-modify-write queue so concurrent requests don't race on the file ──
let queue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => {})
  return next
}

async function readAll(): Promise<StoredConnection[]> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ STORE_PATH, 'utf8')
    return JSON.parse(raw) as StoredConnection[]
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function writeAll(connections: StoredConnection[]): Promise<void> {
  await mkdir(/*turbopackIgnore: true*/ dirname(STORE_PATH), { recursive: true })
  await writeFile(/*turbopackIgnore: true*/ STORE_PATH, JSON.stringify(connections, null, 2), 'utf8')
}

function toPublic(c: StoredConnection): PublicConnection {
  return { id: c.id, name: c.name, maskedUri: maskUri(safeDecrypt(c.cipher)), createdAt: c.createdAt, lastUsed: c.lastUsed }
}

function safeDecrypt(cipher: string): string {
  try {
    return decrypt(cipher)
  } catch {
    return 'mongodb://***decryption-failed***'
  }
}

export async function listConnections(): Promise<PublicConnection[]> {
  const all = await readAll()
  return all.map(toPublic)
}

export async function createConnection(name: string, uri: string): Promise<PublicConnection> {
  validateUri(uri)
  return serialize(async () => {
    const all = await readAll()
    const record: StoredConnection = {
      id: randomUUID(),
      name,
      cipher: encrypt(uri),
      createdAt: new Date().toISOString(),
    }
    all.push(record)
    await writeAll(all)
    return toPublic(record)
  })
}

/** `uri` omitted/empty keeps the existing stored URI; only the name changes. */
export async function updateConnection(id: string, name: string, uri?: string): Promise<PublicConnection> {
  if (uri && uri.trim()) validateUri(uri.trim())
  return serialize(async () => {
    const all = await readAll()
    const idx = all.findIndex((c) => c.id === id)
    if (idx === -1) throw new AppError('Connection not found', 404)
    all[idx] = {
      ...all[idx],
      name,
      cipher: uri && uri.trim() ? encrypt(uri.trim()) : all[idx].cipher,
    }
    await writeAll(all)
    return toPublic(all[idx])
  })
}

export async function deleteConnection(id: string): Promise<void> {
  await serialize(async () => {
    const all = await readAll()
    await writeAll(all.filter((c) => c.id !== id))
  })
}

export async function touchLastUsed(id: string): Promise<void> {
  await serialize(async () => {
    const all = await readAll()
    const conn = all.find((c) => c.id === id)
    if (conn) {
      conn.lastUsed = new Date().toISOString()
      await writeAll(all)
    }
  })
}

/** Server-only: resolve a connection ID to its raw URI for use with the Mongo driver. */
export async function getUri(id: string): Promise<string> {
  const all = await readAll()
  const conn = all.find((c) => c.id === id)
  if (!conn) throw new AppError('Connection not found', 404)
  return decrypt(conn.cipher)
}
