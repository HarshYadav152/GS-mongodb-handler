/**
 * Thrown deliberately by our own code (validation, not-found, etc.) with a
 * message that is safe to show to the client. Anything that is NOT an
 * AppError (raw driver errors, network errors, etc.) must never have its
 * `.message` sent to the client directly — those can leak hostnames,
 * internal topology, auth mechanism details, stack info, etc. Route
 * handlers should log the real error server-side and return a generic
 * message instead. See lib/mongodb.ts and the API routes for usage.
 */
export class AppError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AppError'
    this.status = status
  }
}

/** Standard try/catch handler for route bodies. Logs full detail server-side. */
export function toApiError(err: unknown, fallback = 'Operation failed'): { message: string; status: number } {
  if (err instanceof AppError) {
    return { message: err.message, status: err.status }
  }
  // Unknown/driver error — log full detail server-side only.
  console.error(err)
  return { message: fallback, status: 500 }
}
