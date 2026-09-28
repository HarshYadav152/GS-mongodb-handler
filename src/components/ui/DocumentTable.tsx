'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Pencil, Trash2, Plus, ChevronLeft, ChevronRight,
  RefreshCw, Eye, Copy, Check, FileJson, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import DocumentEditor from './DocumentEditor'
import DocumentViewer from './DocumentViewer'
import type { QueryState } from '@/components/layout/AppShell'

interface DocumentResult {
  documents: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface Props {
  connectionId: string
  database: string
  collection: string
  query: QueryState
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getDocId(doc: Record<string, unknown>): string {
  const id = doc._id
  if (!id) return ''
  if (typeof id === 'object' && id !== null && '$oid' in id) {
    return (id as { $oid: string }).$oid
  }
  return String(id)
}

function formatCell(val: unknown): { text: string; kind: string } {
  if (val === null || val === undefined) return { text: 'null', kind: 'null' }
  if (typeof val === 'boolean')          return { text: String(val), kind: 'bool' }
  if (typeof val === 'number')           return { text: val.toLocaleString(), kind: 'num' }
  if (typeof val === 'string') {
    return { text: val.length > 64 ? val.slice(0, 64) + '…' : val, kind: 'str' }
  }
  if (typeof val === 'object') {
    if ('$oid'  in (val as object)) return { text: (val as {$oid:string}).$oid, kind: 'oid' }
    if ('$date' in (val as object)) {
      return { text: new Date((val as {$date:string}).$date).toLocaleString(), kind: 'date' }
    }
    const s = JSON.stringify(val)
    return { text: s.length > 64 ? s.slice(0, 64) + '…' : s, kind: 'obj' }
  }
  return { text: String(val), kind: 'unknown' }
}

const KIND_COLOR: Record<string, string> = {
  null:    'var(--text-3)',
  bool:    'var(--warning)',
  num:     'var(--info)',
  oid:     'var(--text-3)',
  date:    'var(--brand)',
  obj:     'var(--text-2)',
  str:     'var(--text-1)',
  unknown: 'var(--text-1)',
}

// ── component ─────────────────────────────────────────────────────────────────

export default function DocumentTable({ connectionId, database, collection, query }: Props) {
  const [result,     setResult]     = useState<DocumentResult | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [page,       setPage]       = useState(1)
  // Columns are preserved across pages so the header doesn't vanish on filtered empty pages
  const [columns,    setColumns]    = useState<string[]>([])

  // Modals
  const [viewing,    setViewing]    = useState<Record<string, unknown> | null>(null)
  const [editing,    setEditing]    = useState<Record<string, unknown> | null>(null)
  const [inserting,  setInserting]  = useState(false)

  // Per-row UI state
  const [copiedId,   setCopiedId]   = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Track in-flight request so we can cancel it when props change
  const abortRef = useRef<AbortController | null>(null)

  // ── fetch ─────────────────────────────────────────────────────────────────

  const fetchDocuments = useCallback(async (pageNum: number, keepColumns = false) => {
    if (!connectionId || !database || !collection) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)

    try {
      const skip = (pageNum - 1) * query.limit
      const res  = await fetch('/api/documents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ connectionId, database, collection, ...query, skip }),
        signal:  ctrl.signal,
      })
      const data = await res.json()

      if (data.success) {
        setResult(data.data)
        // Only update column list when we get fresh documents, or when explicitly asked to reset
        if (data.data.documents.length > 0) {
          const keys    = Object.keys(data.data.documents[0])
          const ordered = ['_id', ...keys.filter((k) => k !== '_id')].slice(0, 8)
          if (!keepColumns) setColumns(ordered)
        }
        // If the current page is beyond the total (e.g. after deleting the last doc on a page),
        // jump back to the last valid page automatically
        if (data.data.totalPages > 0 && pageNum > data.data.totalPages) {
          setPage(data.data.totalPages)
        }
      } else {
        setError(data.error || 'Query failed')
        toast.error(data.error || 'Query failed')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError('Network error')
        toast.error('Network error fetching documents')
      }
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, collection, query])

  // Reset page + columns when the collection or query changes (not on page-only changes)
  const prevCollectionRef = useRef('')
  const prevQueryRef      = useRef('')
  useEffect(() => {
    const collKey  = `${connectionId}|${database}|${collection}`
    const queryKey = JSON.stringify(query)
    const collChanged  = collKey  !== prevCollectionRef.current
    const queryChanged = queryKey !== prevQueryRef.current

    prevCollectionRef.current = collKey
    prevQueryRef.current      = queryKey

    if (collChanged) {
      // Hard reset: new collection = new columns
      setPage(1)
      setResult(null)
      setColumns([])
    } else if (queryChanged) {
      // Soft reset: keep columns visible, just jump to page 1
      setPage(1)
      setResult(null)
    }
  }, [connectionId, database, collection, query])

  useEffect(() => {
    // Fetching from the server on page/query change — synchronizing with
    // an external system, which is exactly what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDocuments(page, /* keepColumns */ columns.length > 0)
  }, [fetchDocuments, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── CRUD handlers ─────────────────────────────────────────────────────────

  async function handleDelete(doc: Record<string, unknown>) {
    const displayId = getDocId(doc)
    if (!displayId) return
    if (!confirm('Delete this document permanently?')) return
    setDeletingId(displayId)
    try {
      const res  = await fetch('/api/documents', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // Send the already-serialized `_id` (e.g. {"$oid": "..."}) exactly
        // as the server returned it, rather than a flattened/guessed string
        // — this is what lets the API tell a 24-hex-char *string* id apart
        // from an ObjectId.
        body:    JSON.stringify({ connectionId, database, collection, id: doc._id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Document deleted')
        // If this was the last doc on the current page, the API auto-adjusts in fetchDocuments
        fetchDocuments(page, true)
      } else {
        toast.error(data.error || 'Delete failed')
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleInsertSave(doc: Record<string, unknown>): Promise<void> {
    const res  = await fetch('/api/documents', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ connectionId, database, collection, document: doc }),
    })
    const data = await res.json()
    if (data.success) {
      toast.success(`Inserted — ID: ${data.data.insertedId}`)
      setInserting(false)
      fetchDocuments(page, true)
    } else {
      toast.error(data.error || 'Insert failed')
      throw new Error(data.error)
    }
  }

  async function handleEditSave(doc: Record<string, unknown>): Promise<void> {
    if (!editing) return
    const displayId = getDocId(editing)
    if (!displayId) { toast.error('Cannot determine document _id'); return }

    const { _id: _omit, ...update } = doc
    void _omit
    const res  = await fetch('/api/documents', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ connectionId, database, collection, id: editing._id, update }),
    })
    const data = await res.json()
    if (data.success) {
      toast.success('Document updated')
      setEditing(null)
      fetchDocuments(page, true)
    } else {
      toast.error(data.error || 'Update failed')
      throw new Error(data.error)
    }
  }

  function handleCopyId(doc: Record<string, unknown>) {
    const id = getDocId(doc)
    if (!id) return
    navigator.clipboard.writeText(id).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function goToPage(p: number) {
    const clamped = Math.max(1, Math.min(p, result?.totalPages ?? 1))
    if (clamped !== page) setPage(clamped)
  }

  // ── render ────────────────────────────────────────────────────────────────

  const docs    = result?.documents ?? []
  const isEmpty = !loading && !error && docs.length === 0

  return (
    <div className="space-y-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {loading
              ? 'Loading…'
              : result
              ? `${result.total.toLocaleString()} document${result.total !== 1 ? 's' : ''}`
              : ''}
          </p>
          {result && result.totalPages > 1 && (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              · page {page} of {result.totalPages}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchDocuments(page, true)}
            disabled={loading}
            className="p-1.5 rounded border text-xs transition-colors hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'spin-slow' : ''} />
          </button>
          <button
            onClick={() => setInserting(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:opacity-90"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            <Plus size={13} />
            Insert Document
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-lg border"
          style={{ borderColor: 'var(--danger)', background: 'rgba(248,81,73,0.06)' }}
        >
          <AlertCircle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <span className="text-sm font-mono" style={{ color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      {/* ── Empty ── */}
      {isEmpty && (
        <div
          className="flex flex-col items-center gap-3 py-16 rounded-lg border"
          style={{ borderColor: 'var(--border)', borderStyle: 'dashed' }}
        >
          <FileJson size={28} strokeWidth={1} style={{ color: 'var(--text-3)' }} />
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No documents match this query</p>
          <button
            onClick={() => setInserting(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            <Plus size={12} /> Insert Document
          </button>
        </div>
      )}

      {/* ── Table ── */}
      {(docs.length > 0 || (loading && columns.length > 0)) && (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--border)', overflowX: 'auto' }}
        >
          <table className="text-xs" style={{ minWidth: 'max-content', width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2.5 text-left font-medium whitespace-nowrap"
                    style={{
                      color:        col === '_id' ? 'var(--text-3)' : 'var(--text-2)',
                      borderBottom: '1px solid var(--border)',
                      fontFamily:   'JetBrains Mono, monospace',
                    }}
                  >
                    {col}
                  </th>
                ))}
                <th
                  className="px-3 py-2.5 text-right font-medium whitespace-nowrap sticky right-0"
                  style={{
                    color:        'var(--text-3)',
                    borderBottom: '1px solid var(--border)',
                    background:   'var(--surface-2)',
                  }}
                >
                  {loading ? <RefreshCw size={11} className="spin-slow inline" /> : 'Actions'}
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => {
                const id         = getDocId(doc)
                const isDeleting = deletingId === id

                return (
                  <tr
                    key={id || i}
                    className="border-b group"
                    style={{
                      borderColor: 'var(--border)',
                      background:  isDeleting ? 'rgba(248,81,73,0.05)' : undefined,
                      opacity:     isDeleting ? 0.5 : 1,
                      transition:  'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isDeleting)
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isDeleting)
                        (e.currentTarget as HTMLElement).style.background = ''
                    }}
                  >
                    {columns.map((col) => {
                      const { text, kind } = formatCell(doc[col])
                      return (
                        <td
                          key={col}
                          className="px-3 py-2 truncate max-w-xs"
                          style={{ color: KIND_COLOR[kind], fontFamily: 'JetBrains Mono, monospace' }}
                          title={JSON.stringify(doc[col])}
                        >
                          {text}
                        </td>
                      )
                    })}

                    {/* Actions column — sticky right */}
                    <td
                      className="px-3 py-2 sticky right-0"
                      style={{ background: 'inherit' }}
                    >
                      <div className="flex items-center gap-0.5 justify-end opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <ActionBtn
                          title="Copy ID"
                          onClick={() => handleCopyId(doc)}
                          color={copiedId === id ? 'var(--brand)' : 'var(--text-3)'}
                        >
                          {copiedId === id ? <Check size={12} /> : <Copy size={12} />}
                        </ActionBtn>
                        <ActionBtn title="View" onClick={() => setViewing(doc)} color="var(--text-3)">
                          <Eye size={12} />
                        </ActionBtn>
                        <ActionBtn title="Edit" onClick={() => setEditing(doc)} color="var(--text-2)">
                          <Pencil size={12} />
                        </ActionBtn>
                        <ActionBtn
                          title="Delete"
                          onClick={() => handleDelete(doc)}
                          color="var(--danger)"
                          disabled={isDeleting}
                        >
                          <Trash2 size={12} />
                        </ActionBtn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {result && result.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={result.totalPages}
          onPage={goToPage}
        />
      )}

      {/* ── Modals ── */}
      {viewing  && (
        <DocumentViewer
          document={viewing}
          onEdit={() => { setEditing(viewing); setViewing(null) }}
          onClose={() => setViewing(null)}
        />
      )}
      {editing  && (
        <DocumentEditor
          key={getDocId(editing)}
          document={editing}
          mode="edit"
          onSave={handleEditSave}
          onClose={() => setEditing(null)}
        />
      )}
      {inserting && (
        <DocumentEditor
          key="insert"
          document={{}}
          mode="insert"
          onSave={handleInsertSave}
          onClose={() => setInserting(false)}
        />
      )}
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

function ActionBtn({
  children, title, onClick, color, disabled,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  color: string
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded transition-colors hover:bg-white/10 disabled:opacity-30"
      style={{ color }}
    >
      {children}
    </button>
  )
}

function Pagination({
  page, totalPages, onPage,
}: { page: number; totalPages: number; onPage: (p: number) => void }) {
  // Build a sliding window of at most 7 page buttons
  function pageNumbers(): number[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (page <= 4)                  return [1, 2, 3, 4, 5, 6, 7]
    if (page >= totalPages - 3)     return Array.from({ length: 7 }, (_, i) => totalPages - 6 + i)
    return Array.from({ length: 7 }, (_, i) => page - 3 + i)
  }

  return (
    <div className="flex items-center justify-center gap-1.5 py-2">
      <NavBtn disabled={page === 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={13} />
        <span>Prev</span>
      </NavBtn>

      {pageNumbers().map((p) => (
        <button
          key={p}
          onClick={() => onPage(p)}
          className="w-8 h-8 rounded text-xs font-mono transition-all"
          style={{
            background: p === page ? 'var(--brand)' : 'transparent',
            color:      p === page ? '#fff' : 'var(--text-3)',
            border:     `1px solid ${p === page ? 'var(--brand)' : 'transparent'}`,
          }}
        >
          {p}
        </button>
      ))}

      <NavBtn disabled={page === totalPages} onClick={() => onPage(page + 1)}>
        <span>Next</span>
        <ChevronRight size={13} />
      </NavBtn>
    </div>
  )
}

function NavBtn({
  children, disabled, onClick,
}: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs transition-all hover:bg-white/5 disabled:opacity-30"
      style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
    >
      {children}
    </button>
  )
}
