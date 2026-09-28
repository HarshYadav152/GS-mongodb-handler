'use client'
import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import {
  Database, Layers, Settings, ChevronRight, ChevronDown,
  RefreshCw, HardDrive, Plus, Trash2, X, Check,
  MoreHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'

interface DbInfo { name: string; sizeOnDisk?: number }
interface ColInfo { name: string; type: string; count?: number }

interface Props {
  connectionId: string | null
  activeDb: string | null
  activeCol: string | null
  onSelectCollection: (db: string, col: string) => void
  onManageConnections: () => void
  /** Called after a drop so the parent can reset its active selection if needed */
  onCollectionDropped?: (db: string, col: string) => void
  onDatabaseDropped?: (db: string) => void
  /** Mobile-only drawer state */
  mobileOpen?: boolean
  onMobileClose?: () => void
}

function fmtBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

// ── tiny inline context-menu component ───────────────────────────────────────
interface MenuProps {
  items: { label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void }[]
  onClose: () => void
  /** Resolves the trigger button lazily, from inside an effect — never read
   *  during render. (Reading a ref's `.current` while rendering isn't safe:
   *  it isn't guaranteed to reflect the latest committed DOM node, especially
   *  under Strict Mode / concurrent rendering.) */
  getAnchorEl: () => HTMLElement | null
}

function ContextMenu({ items, onClose, getAnchorEl }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const anchorEl = getAnchorEl()
    if (!anchorEl) { onClose(); return }
    const rect = anchorEl.getBoundingClientRect()
    // This is exactly the documented exception to "don't setState in an
    // effect": measuring a DOM node's position after commit and storing it
    // in state, since it can't be computed during render. See
    // https://react.dev/learn/you-might-not-need-an-effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({ top: rect.bottom + 4, left: rect.left })
    // Intentionally only run once, when the menu opens — not on every
    // onClose/getAnchorEl identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('keydown', handleKey) }
  }, [onClose])

  // Not positioned yet (first paint) — render nothing rather than flash at (0,0).
  if (!pos) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-lg border py-1 shadow-xl"
      style={{
        top: pos.top, left: pos.left,
        background: 'var(--surface-2)',
        borderColor: 'var(--border)',
        minWidth: '160px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose() }}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/8"
          style={{ color: item.danger ? 'var(--danger)' : 'var(--text-2)' }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ── inline "create collection" input ─────────────────────────────────────────
interface CreateColProps { onConfirm: (name: string) => void; onCancel: () => void }
function CreateCollectionInput({ onConfirm, onCancel }: CreateColProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  function submit() {
    const name = value.trim()
    if (name) onConfirm(name)
  }

  return (
    <div className="flex items-center gap-1 pl-5 pr-2 py-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="collection name"
        className="flex-1 px-2 py-1 rounded text-xs border outline-none font-mono"
        style={{ background: 'var(--surface-3)', borderColor: 'var(--brand)', color: 'var(--text-1)', minWidth: 0 }}
      />
      <button onClick={submit} className="p-1 rounded" style={{ color: 'var(--brand)' }} title="Create">
        <Check size={12} />
      </button>
      <button onClick={onCancel} className="p-1 rounded" style={{ color: 'var(--text-3)' }} title="Cancel">
        <X size={12} />
      </button>
    </div>
  )
}

// ── main Sidebar ──────────────────────────────────────────────────────────────
export default function Sidebar({
  connectionId, activeDb, activeCol,
  onSelectCollection, onManageConnections,
  onCollectionDropped, onDatabaseDropped,
  mobileOpen = false, onMobileClose,
}: Props) {
  const [databases, setDatabases]     = useState<DbInfo[]>([])
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set())
  const [collections, setCollections] = useState<Record<string, ColInfo[]>>({})
  const [loadingDbs, setLoadingDbs]   = useState(false)
  const [loadingCols, setLoadingCols] = useState<Set<string>>(new Set())

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    type: 'db' | 'col'; dbName: string; colName?: string
  } | null>(null)
  const ctxAnchorRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Inline "create collection" input per db
  const [creatingColIn, setCreatingColIn] = useState<string | null>(null)

  // ── data fetching ─────────────────────────────────────────────────────────
  const fetchDatabases = useCallback(async () => {
    if (!connectionId) return
    setLoadingDbs(true)
    try {
      const res  = await fetch('/api/databases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const data = await res.json()
      if (data.success) setDatabases(data.data)
      else toast.error(data.error || 'Failed to load databases')
    } catch { toast.error('Network error loading databases') }
    finally { setLoadingDbs(false) }
  }, [connectionId])

  const fetchCollections = useCallback(async (dbName: string) => {
    if (!connectionId) return
    setLoadingCols((p) => new Set(Array.from(p).concat(dbName)))
    try {
      const res  = await fetch('/api/collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database: dbName }),
      })
      const data = await res.json()
      if (data.success) setCollections((p) => ({ ...p, [dbName]: data.data }))
      else toast.error(data.error || 'Failed to load collections')
    } catch { toast.error('Network error loading collections') }
    finally {
      setLoadingCols((p) => { const n = new Set(p); n.delete(dbName); return n })
    }
  }, [connectionId])

  useEffect(() => {
    // Resetting local UI state when the active connection changes, then
    // kicking off the fetch for the new one — a standard "sync with an
    // external system (the server) when a prop changes" effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDatabases([]); setCollections({}); setExpandedDbs(new Set())
    fetchDatabases()
  }, [connectionId, fetchDatabases])

  async function toggleDb(dbName: string) {
    const next = new Set(expandedDbs)
    if (next.has(dbName)) { next.delete(dbName) }
    else {
      next.add(dbName)
      if (!collections[dbName]) await fetchCollections(dbName)
    }
    setExpandedDbs(next)
  }

  // ── collection / database actions ─────────────────────────────────────────
  async function handleCreateCollection(dbName: string, colName: string) {
    setCreatingColIn(null)
    try {
      const res  = await fetch('/api/collections/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database: dbName, collection: colName }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Collection "${colName}" created`)
        await fetchCollections(dbName)
      } else {
        toast.error(data.error || 'Failed to create collection')
      }
    } catch { toast.error('Network error') }
  }

  async function handleDropCollection(dbName: string, colName: string) {
    if (!confirm(`Drop collection "${colName}"? This cannot be undone.`)) return
    try {
      const res  = await fetch('/api/collections/manage', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database: dbName, collection: colName, confirm: colName }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Collection "${colName}" dropped`)
        await fetchCollections(dbName)
        onCollectionDropped?.(dbName, colName)
      } else {
        toast.error(data.error || 'Failed to drop collection')
      }
    } catch { toast.error('Network error') }
  }

  async function handleDropDatabase(dbName: string) {
    if (!confirm(`Drop database "${dbName}"? ALL collections and documents will be permanently deleted.`)) return
    try {
      const res  = await fetch('/api/databases/manage', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, database: dbName, confirm: dbName }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Database "${dbName}" dropped`)
        await fetchDatabases()
        onDatabaseDropped?.(dbName)
      } else {
        toast.error(data.error || 'Failed to drop database')
      }
    } catch { toast.error('Network error') }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <aside
      className={`flex flex-col border-r h-full shrink-0 fixed md:static inset-y-0 left-0 z-40 transition-transform duration-200 ease-out md:translate-x-0 ${
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      }`}
      style={{ width: '256px', maxWidth: '85vw', background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      aria-label="Database explorer"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 border-b shrink-0"
        style={{ borderColor: 'var(--border)', height: '48px' }}
      >
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
          Explorer
        </span>
        <div className="flex gap-0.5">
          <button
            onClick={fetchDatabases}
            disabled={loadingDbs}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-3)' }}
            title="Refresh"
          >
            <RefreshCw size={13} className={loadingDbs ? 'spin-slow' : ''} />
          </button>
          <button
            onClick={onManageConnections}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-3)' }}
            title="Manage connections"
          >
            <Settings size={13} />
          </button>
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="md:hidden p-1.5 rounded transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-3)' }}
              title="Close"
              aria-label="Close sidebar"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <nav className="flex-1 overflow-y-auto py-1">
        {!connectionId ? (
          <div className="flex flex-col items-center gap-2 mt-12 px-4 text-center">
            <HardDrive size={24} strokeWidth={1} style={{ color: 'var(--text-3)' }} />
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>No connection active</p>
            <button
              onClick={onManageConnections}
              className="text-xs px-3 py-1.5 rounded border transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              Connect
            </button>
          </div>
        ) : loadingDbs ? (
          <div className="flex items-center justify-center mt-8">
            <RefreshCw size={16} className="spin-slow" style={{ color: 'var(--text-3)' }} />
          </div>
        ) : databases.length === 0 ? (
          <p className="text-xs text-center mt-8 px-4" style={{ color: 'var(--text-3)' }}>
            No databases found
          </p>
        ) : (
          databases.map((db) => {
            const isExpanded   = expandedDbs.has(db.name)
            const isLoadingCol = loadingCols.has(db.name)
            const cols         = collections[db.name] || []
            const menuKey      = `db-${db.name}`

            return (
              <div key={db.name}>
                {/* ── Database row ── */}
                <div className="flex items-center group/db mx-1" style={{ width: 'calc(100% - 8px)' }}>
                  <button
                    onClick={() => toggleDb(db.name)}
                    className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors hover:bg-white/5 min-w-0"
                    style={{ color: 'var(--text-2)' }}
                  >
                    <span className="shrink-0" style={{ color: 'var(--text-3)' }}>
                      {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </span>
                    <Database size={13} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                    <span className="text-xs font-medium truncate flex-1">{db.name}</span>
                    {db.sizeOnDisk != null && db.sizeOnDisk > 0 && (
                      <span style={{ color: 'var(--text-3)', fontSize: '10px', flexShrink: 0 }}>
                        {fmtBytes(db.sizeOnDisk)}
                      </span>
                    )}
                  </button>
                  {/* DB actions — visible on hover */}
                  <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover/db:opacity-100 transition-opacity shrink-0 pr-1">
                    <button
                      onClick={() => { setCreatingColIn(db.name); if (!isExpanded) toggleDb(db.name) }}
                      className="p-1 rounded hover:bg-white/10"
                      style={{ color: 'var(--text-3)' }}
                      title="New collection"
                    >
                      <Plus size={11} />
                    </button>
                    <button
                      ref={(el) => { ctxAnchorRefs.current[menuKey] = el }}
                      onClick={() => setCtxMenu({ type: 'db', dbName: db.name })}
                      className="p-1 rounded hover:bg-white/10"
                      style={{ color: 'var(--text-3)' }}
                      title="More options"
                    >
                      <MoreHorizontal size={11} />
                    </button>
                  </div>
                </div>

                {/* ── Collections ── */}
                {isExpanded && (
                  <div>
                    {isLoadingCol ? (
                      <div className="pl-8 py-1.5">
                        <RefreshCw size={11} className="spin-slow" style={{ color: 'var(--text-3)' }} />
                      </div>
                    ) : (
                      <>
                        {cols.length === 0 && creatingColIn !== db.name && (
                          <p className="pl-8 text-xs py-1" style={{ color: 'var(--text-3)' }}>
                            No collections
                          </p>
                        )}
                        {cols.map((col) => {
                          const isActive = activeDb === db.name && activeCol === col.name
                          const colKey   = `col-${db.name}-${col.name}`
                          return (
                            <div
                              key={col.name}
                              className="flex items-center group/col mx-1"
                              style={{ width: 'calc(100% - 8px)' }}
                            >
                              <button
                                onClick={() => onSelectCollection(db.name, col.name)}
                                className="flex-1 flex items-center gap-1.5 pl-7 pr-1 py-1.5 rounded text-left transition-all min-w-0"
                                style={{
                                  color:      isActive ? 'var(--brand)' : 'var(--text-2)',
                                  background: isActive ? 'rgba(63,185,80,0.1)' : 'transparent',
                                }}
                              >
                                <Layers
                                  size={11}
                                  style={{ color: isActive ? 'var(--brand)' : 'var(--text-3)', flexShrink: 0 }}
                                />
                                <span className="text-xs truncate flex-1">{col.name}</span>
                                {col.count != null && (
                                  <span style={{ color: 'var(--text-3)', fontSize: '10px', flexShrink: 0 }}>
                                    {col.count.toLocaleString()}
                                  </span>
                                )}
                              </button>
                              {/* Collection actions */}
                              <div className="flex items-center opacity-100 md:opacity-0 md:group-hover/col:opacity-100 transition-opacity shrink-0 pr-1">
                                <button
                                  ref={(el) => { ctxAnchorRefs.current[colKey] = el }}
                                  onClick={() => setCtxMenu({ type: 'col', dbName: db.name, colName: col.name })}
                                  className="p-1 rounded hover:bg-white/10"
                                  style={{ color: 'var(--text-3)' }}
                                  title="More options"
                                >
                                  <MoreHorizontal size={11} />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                        {/* Inline "create collection" input */}
                        {creatingColIn === db.name && (
                          <CreateCollectionInput
                            onConfirm={(name) => handleCreateCollection(db.name, name)}
                            onCancel={() => setCreatingColIn(null)}
                          />
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2 border-t shrink-0" style={{ borderColor: 'var(--border)' }}>
        <p style={{ color: 'var(--text-3)', fontSize: '10px' }}>
          {connectionId ? `${databases.length} database${databases.length !== 1 ? 's' : ''}` : 'Not connected'}
        </p>
      </div>

      {/* Context menu (renders in portal-like fixed div) */}
      {ctxMenu && (() => {
        // Pure string computation only — no ref access here. The actual
        // ctxAnchorRefs.current[key] lookup happens inside ContextMenu's
        // own effect, not during this render.
        const key = ctxMenu.type === 'db' ? `db-${ctxMenu.dbName}` : `col-${ctxMenu.dbName}-${ctxMenu.colName}`

        const dbItems = [
          {
            label: 'New collection',
            icon: <Plus size={12} />,
            onClick: () => { setCreatingColIn(ctxMenu.dbName); if (!expandedDbs.has(ctxMenu.dbName)) toggleDb(ctxMenu.dbName) },
          },
          {
            label: 'Refresh',
            icon: <RefreshCw size={12} />,
            onClick: () => fetchCollections(ctxMenu.dbName),
          },
          {
            label: 'Drop database',
            icon: <Trash2 size={12} />,
            danger: true,
            onClick: () => handleDropDatabase(ctxMenu.dbName),
          },
        ]

        const colItems = [
          {
            label: 'Refresh',
            icon: <RefreshCw size={12} />,
            onClick: () => fetchCollections(ctxMenu.dbName),
          },
          {
            label: 'Drop collection',
            icon: <Trash2 size={12} />,
            danger: true,
            onClick: () => handleDropCollection(ctxMenu.dbName, ctxMenu.colName!),
          },
        ]

        return (
          <ContextMenu
            key={key}
            items={ctxMenu.type === 'db' ? dbItems : colItems}
            onClose={() => setCtxMenu(null)}
            getAnchorEl={() => ctxAnchorRefs.current[key] ?? null}
          />
        )
      })()}
    </aside>
  )
}
