// A saved connection as seen by the browser: never the raw URI, never the
// ciphertext — only an opaque id, a display name, and a masked URI for
// showing in the list. The server resolves `id` to the real URI itself.
export interface SavedConnection {
  id: string
  name: string
  maskedUri: string
  createdAt: string
  lastUsed?: string
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk?: number
  empty?: boolean
}

export interface CollectionInfo {
  name: string
  type: string
  count?: number
}

export interface DocumentResult {
  documents: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface QueryParams {
  filter: string
  sort: string
  limit: number
  skip: number
  projection: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
