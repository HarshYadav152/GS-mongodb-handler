/** Redact the password portion of a MongoDB URI for display purposes. */
export function maskUri(uri: string): string {
  try {
    const url = new URL(uri)
    if (url.password) {
      url.password = '****'
    }
    return url.toString()
  } catch {
    // Not a valid URL (e.g. mongodb+srv with characters URL can't parse) —
    // fall back to a regex redaction of the credentials segment.
    return uri.replace(/:([^@/]+)@/, ':****@')
  }
}
