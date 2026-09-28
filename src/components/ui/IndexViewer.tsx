'use client'
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Plus, Trash2, Key, X, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface IndexInfo {
  name: string
  key: Record<string, unknown>
  unique?: boolean
  sparse?: boolean
  background?: boolean
  expireAfterSeconds?: number
  [key: string]: unknown
}

interface CollectionStats {
  count: number
  size: number
  avgObjSize: number
  totalIndexSize: number
  nindexes: number
}

interface Props {
  connectionId: string
  database: string
  collection: string
  onClose: () => void
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-base font-semibold font-mono" style={{ color: 'var(--text-1)' }}>{value}</p>
    </div>
  )
}

export default function IndexViewer({ connectionId, database, collection, onClose }: Props) {
  const [indexes, setIndexes]   = useState<IndexInfo[]>([])
  const [stats, setStats]       = useState<CollectionStats | null>(null)
  const [loading, setLoading]   = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  // Create-index form
  const [newKeys, setNewKeys]       = useState('{"field": 1}')
  const [newName, setNewName]       = useState('')
  const [newUnique, setNewUnique]   = useState(false)
  const [newSparse, setNewSparse]   = useState(false)
  const [newTTL, setNewTTL]         = useState('')
  const [createErr, setCreateErr]   = useState('')
  const [creating, setCreating]     = useState(false)
  const [droppingIdx, setDroppingIdx] = useState<string | null>(null)

  const fetchIndexes = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/indexes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database, collection }),
      })
      const data = await res.json()
      if (data.success) {
        setIndexes(data.data.indexes)
        setStats(data.data.stats)
      } else {
        toast.error(data.error || 'Failed to load indexes')
      }
    } catch { toast.error('Network error') }
    finally { setLoading(false) }
  }, [connectionId, database, collection])

  // Fetching from the server on mount/dependency change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchIndexes() }, [fetchIndexes])

  async function handleCreate() {
    setCreateErr('')
    let keys: Record<string, unknown>
    try { keys = JSON.parse(newKeys) } catch { setCreateErr('Keys must be valid JSON, e.g. {"field": 1}'); return }

    const options: Record<string, unknown> = {}
    if (newName.trim())  options.name = newName.trim()
    if (newUnique)       options.unique = true
    if (newSparse)       options.sparse = true
    if (newTTL.trim() && Number(newTTL) >= 0) options.expireAfterSeconds = Number(newTTL)

    setCreating(true)
    try {
      const res  = await fetch('/api/indexes', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database, collection, keys, options }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Index "${data.data.indexName}" created`)
        setShowCreate(false)
        setNewKeys('{"field": 1}'); setNewName(''); setNewUnique(false); setNewSparse(false); setNewTTL('')
        await fetchIndexes()
      } else {
        setCreateErr(data.error || 'Failed to create index')
      }
    } catch { setCreateErr('Network error') }
    finally { setCreating(false) }
  }

  async function handleDrop(indexName: string) {
    if (!confirm(`Drop index "${indexName}"?`)) return
    setDroppingIdx(indexName)
    try {
      const res  = await fetch('/api/indexes', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database, collection, indexName }),
      })
      const data = await res.json()
      if (data.success) { toast.success(`Index "${indexName}" dropped`); await fetchIndexes() }
      else toast.error(data.error || 'Failed to drop index')
    } catch { toast.error('Network error') }
    finally { setDroppingIdx(null) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl rounded-xl border flex flex-col animate-fade-in"
        style={{
          background: 'var(--surface-1)', borderColor: 'var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)', maxHeight: 'calc(100vh - 64px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Indexes</h2>
            <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>
              {database} / {collection}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchIndexes}
              className="p-1.5 rounded transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-3)' }}
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'spin-slow' : ''} />
            </button>
            <button
              onClick={() => setShowCreate((p) => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
              style={{ background: 'var(--brand)', color: '#fff' }}
            >
              <Plus size={12} /> <span className="hidden sm:inline">New Index</span>
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-3)' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Collection stats */}
          {stats && (
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Documents"       value={stats.count.toLocaleString()} />
              <StatCard label="Data size"       value={fmtBytes(stats.size)} />
              <StatCard label="Avg object"      value={fmtBytes(stats.avgObjSize || 0)} />
              <StatCard label="Index size"      value={fmtBytes(stats.totalIndexSize)} />
            </div>
          )}

          {/* Create index form */}
          {showCreate && (
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--brand)', background: 'rgba(63,185,80,0.04)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Create index</p>

              <div className="space-y-1">
                <label className="text-xs" style={{ color: 'var(--text-3)' }}>Keys (JSON)</label>
                <input
                  value={newKeys}
                  onChange={(e) => { setNewKeys(e.target.value); setCreateErr('') }}
                  placeholder='{"field": 1}'
                  spellCheck={false}
                  className="w-full px-3 py-2 rounded border text-xs font-mono outline-none"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--brand)')}
                  onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs" style={{ color: 'var(--text-3)' }}>Name (optional)</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="auto-generated"
                    className="w-full px-3 py-2 rounded border text-xs outline-none"
                    style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--brand)')}
                    onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs" style={{ color: 'var(--text-3)' }}>TTL (seconds, optional)</label>
                  <input
                    type="number"
                    value={newTTL}
                    onChange={(e) => setNewTTL(e.target.value)}
                    placeholder="e.g. 3600"
                    className="w-full px-3 py-2 rounded border text-xs font-mono outline-none"
                    style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--brand)')}
                    onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                {[
                  { id: 'idx-unique', label: 'Unique', val: newUnique, set: setNewUnique },
                  { id: 'idx-sparse', label: 'Sparse', val: newSparse, set: setNewSparse },
                ].map(({ id, label, val, set }) => (
                  <label key={id} className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: 'var(--text-2)' }}>
                    <input
                      type="checkbox"
                      id={id}
                      checked={val}
                      onChange={(e) => set(e.target.checked)}
                      className="rounded"
                      style={{ accentColor: 'var(--brand)' }}
                    />
                    {label}
                  </label>
                ))}
              </div>

              {createErr && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--danger)' }}>
                  <AlertCircle size={12} /> {createErr}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ background: 'var(--brand)', color: '#fff' }}
                >
                  {creating ? <RefreshCw size={11} className="spin-slow" /> : <Check size={11} />}
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setCreateErr('') }}
                  className="px-3 py-1.5 rounded text-xs transition-colors hover:bg-white/5"
                  style={{ color: 'var(--text-3)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Index list */}
          {loading ? (
            <div className="flex justify-center py-8">
              <RefreshCw size={18} className="spin-slow" style={{ color: 'var(--text-3)' }} />
            </div>
          ) : indexes.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: 'var(--text-3)' }}>No indexes found</p>
          ) : (
            <div className="space-y-2">
              {indexes.map((idx) => {
                const isId      = idx.name === '_id_'
                const isDropping = droppingIdx === idx.name
                return (
                  <div
                    key={idx.name}
                    className="flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors"
                    style={{
                      borderColor: 'var(--border)',
                      background: isDropping ? 'rgba(248,81,73,0.05)' : 'var(--surface-2)',
                      opacity: isDropping ? 0.5 : 1,
                    }}
                  >
                    <Key
                      size={14}
                      style={{ color: isId ? 'var(--brand)' : 'var(--text-3)', marginTop: 2, flexShrink: 0 }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium font-mono" style={{ color: 'var(--text-1)' }}>
                          {idx.name}
                        </span>
                        {isId && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(63,185,80,0.15)', color: 'var(--brand)', fontSize: '10px' }}>
                            default
                          </span>
                        )}
                        {idx.unique && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(88,166,255,0.15)', color: 'var(--info)', fontSize: '10px' }}>
                            unique
                          </span>
                        )}
                        {idx.sparse && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(210,153,34,0.15)', color: 'var(--warning)', fontSize: '10px' }}>
                            sparse
                          </span>
                        )}
                        {idx.expireAfterSeconds != null && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(210,153,34,0.15)', color: 'var(--warning)', fontSize: '10px' }}>
                            TTL {idx.expireAfterSeconds}s
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-3)' }}>
                        {JSON.stringify(idx.key)}
                      </p>
                    </div>
                    {!isId && (
                      <button
                        onClick={() => handleDrop(idx.name)}
                        disabled={isDropping}
                        className="p-1.5 rounded transition-colors hover:bg-white/10 disabled:opacity-40"
                        style={{ color: 'var(--danger)', flexShrink: 0 }}
                        title="Drop index"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
