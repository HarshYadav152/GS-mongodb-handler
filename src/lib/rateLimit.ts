// Best-effort in-memory rate limiter (per server process). Good enough to
// slow down brute-force login attempts on a single-instance deployment;
// not a substitute for a real rate-limiting layer if you deploy this
// behind multiple instances or a load balancer.

interface Bucket { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/**
 * Returns true if the request under `key` is allowed, false if rate-limited.
 * `limit` attempts per `windowMs`.
 */
export function rateLimit(key: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now > existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= limit) return false

  existing.count += 1
  return true
}

// Periodically forget stale buckets so this map doesn't grow forever.
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key)
  }
}, 5 * 60_000).unref?.()
