import 'server-only'
import { MongoClient, MongoClientOptions } from 'mongodb'
import { AppError } from './errors'

// Per-URI client pool (server-side only), bounded with simple LRU eviction
// so a long-running server process can't accumulate unbounded connections
// (see audit finding: "unbounded connection cache").
const MAX_CACHED_CLIENTS = 25
const clients = new Map<string, MongoClient>()

const POOL_OPTIONS: MongoClientOptions = {
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS:         10_000,
  socketTimeoutMS:          30_000,
  maxPoolSize:              10,
  minPoolSize:              0,
  maxIdleTimeMS:            60_000,
}

/** Basic sanity check before handing a URI to the driver */
export function validateUri(uri: string): void {
  const trimmed = uri.trim()
  if (!trimmed) throw new AppError('MongoDB URI cannot be empty')
  if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
    throw new AppError('URI must start with mongodb:// or mongodb+srv://')
  }
}

/** Move (or insert) a key to the "most recently used" end of the Map. */
function touchLru(uri: string, client: MongoClient) {
  clients.delete(uri)
  clients.set(uri, client)
  while (clients.size > MAX_CACHED_CLIENTS) {
    const oldestKey = clients.keys().next().value
    if (oldestKey === undefined) break
    const oldest = clients.get(oldestKey)
    clients.delete(oldestKey)
    oldest?.close().catch(() => { /* ignore */ })
  }
}

/**
 * Get (or create) a cached MongoClient for the given URI.
 * Pings the server on cache hit to detect stale connections.
 */
export async function getClient(uri: string): Promise<MongoClient> {
  validateUri(uri)

  const existing = clients.get(uri)
  if (existing) {
    try {
      await existing.db('admin').command({ ping: 1 })
      touchLru(uri, existing)
      return existing
    } catch {
      // Stale connection — close silently and reconnect
      clients.delete(uri)
      try { await existing.close() } catch { /* ignore */ }
    }
  }

  const client = new MongoClient(uri, POOL_OPTIONS)
  try {
    await client.connect()
  } catch {
    // Don't leak driver connection error detail (hostnames, topology, auth
    // mechanism, etc.) to the client — log it server-side instead.
    throw new AppError('Unable to connect to the database with the given URI')
  }

  touchLru(uri, client)
  return client
}

/**
 * Open a fresh, short-lived connection to test a URI.
 * Never cached — always closes after the ping.
 */
export async function testConnection(uri: string): Promise<{
  ok: boolean
  latencyMs: number
  serverInfo: Record<string, unknown>
}> {
  validateUri(uri)

  const t0     = Date.now()
  const client = new MongoClient(uri, {
    ...POOL_OPTIONS,
    maxPoolSize:              1,
    serverSelectionTimeoutMS: 5_000,
  })

  try {
    await client.connect()
    const info = await client.db('admin').command({ buildInfo: 1 })
    return {
      ok:         true,
      latencyMs:  Date.now() - t0,
      serverInfo: {
        version:        info.version        ?? 'unknown',
        gitVersion:     info.gitVersion     ?? 'unknown',
        storageEngines: info.storageEngines ?? [],
      },
    }
  } catch {
    throw new AppError('Unable to connect to the database with the given URI')
  } finally {
    try { await client.close() } catch { /* ignore */ }
  }
}

/** Explicitly close and evict a cached client */
export async function closeClient(uri: string): Promise<void> {
  const client = clients.get(uri)
  if (client) {
    clients.delete(uri)
    try { await client.close() } catch { /* ignore */ }
  }
}

// ── Query-filter parsing + operator allowlisting ──────────────────────────
//
// This app intentionally lets an authenticated operator run arbitrary
// find() filters — that's the point of a Mongo GUI. But a handful of
// operators execute server-side JavaScript on the MongoDB server (or are
// otherwise unusually dangerous to expose to a query box), so those are
// rejected outright regardless of how deeply they're nested (e.g. inside
// $and/$or/$not).
const DISALLOWED_OPERATORS = new Set(['$where', '$function', '$accumulator', '$mapReduce'])

function assertNoDisallowedOperators(value: unknown, path = ''): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoDisallowedOperators(v, `${path}[${i}]`))
    return
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DISALLOWED_OPERATORS.has(k)) {
      throw new AppError(`Operator "${k}" is not allowed`)
    }
    assertNoDisallowedOperators(v, path ? `${path}.${k}` : k)
  }
}

/**
 * Parse a filter/sort/projection string into a plain object.
 * Empty string or "{}" returns {} without throwing.
 * `checkOperators` should be true for query filters and update payloads
 * (where $where-style server-side JS execution is the concern) and can be
 * left false for sort/projection specs, which don't accept those operators.
 */
export function parseQueryFilter(filterStr: string, checkOperators = false): Record<string, unknown> {
  const trimmed = (filterStr ?? '').trim()
  if (!trimmed || trimmed === '{}') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON'
    throw new AppError(`Invalid filter: ${message}`)
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new AppError('Filter must be a JSON object')
  }
  if (checkOperators) assertNoDisallowedOperators(parsed)
  return parsed as Record<string, unknown>
}

/** Same operator check, for use on an already-parsed object (e.g. update payloads). */
export function assertSafeQueryObject(obj: unknown): void {
  assertNoDisallowedOperators(obj)
}
