'use client'
import { useState } from 'react'
import Sidebar from './Sidebar'
import DocumentTable from '@/components/ui/DocumentTable'
import QueryBar from '@/components/ui/QueryBar'
import ConnectionManager from '@/components/ui/ConnectionManager'
import IndexViewer from '@/components/ui/IndexViewer'
import { useTheme } from './ThemeProvider'
import { Sun, Moon, Database, Plug, ChevronRight, ListTree, Menu } from 'lucide-react'

export interface QueryState {
  filter: string
  sort: string
  limit: number
  skip: number
}

export default function AppShell() {
  const { theme, toggle } = useTheme()
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [activeConnName, setActiveConnName] = useState<string | null>(null)
  const [activeDb, setActiveDb] = useState<string | null>(null)
  const [activeCol, setActiveCol] = useState<string | null>(null)
  const [showConnMgr, setShowConnMgr] = useState(true)
  const [showIndexes, setShowIndexes] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [query, setQuery] = useState<QueryState>({
    filter: '{}',
    sort: '{}',
    limit: 20,
    skip: 0,
  })

  function handleConnect(connectionId: string, name: string) {
    setActiveConnectionId(connectionId)
    setActiveConnName(name)
    setActiveDb(null)
    setActiveCol(null)
    setShowConnMgr(false)
  }

  function handleSelectCollection(db: string, col: string) {
    setActiveDb(db)
    setActiveCol(col)
    setQuery({ filter: '{}', sort: '{}', limit: 20, skip: 0 })
    setSidebarOpen(false) // auto-close mobile drawer on selection
  }

  return (
    <div
      className="flex overflow-hidden"
      style={{ background: 'var(--surface-0)', height: '100dvh' }}
    >
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 animate-overlay-in"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar
        connectionId={activeConnectionId}
        activeDb={activeDb}
        activeCol={activeCol}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        onSelectCollection={handleSelectCollection}
        onManageConnections={() => { setShowConnMgr(true); setSidebarOpen(false) }}
        onCollectionDropped={(db, col) => {
          if (activeDb === db && activeCol === col) {
            setActiveDb(null)
            setActiveCol(null)
          }
        }}
        onDatabaseDropped={(db) => {
          if (activeDb === db) {
            setActiveDb(null)
            setActiveCol(null)
          }
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header
          className="flex items-center justify-between gap-2 px-3 sm:px-5 py-0 border-b shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', height: '48px' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden -ml-1 p-1.5 rounded transition-colors hover:bg-white/5 shrink-0"
              style={{ color: 'var(--text-2)' }}
              aria-label="Open sidebar"
            >
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <Database size={16} style={{ color: 'var(--brand)' }} />
              <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-1)' }}>
                GS-mongo
              </span>
            </div>
            {activeConnName && (
              <>
                <ChevronRight size={12} style={{ color: 'var(--text-3)' }} className="hidden sm:block" />
                <span
                  className="hidden sm:inline-block text-xs px-2 py-0.5 rounded font-mono shrink-0 truncate max-w-[140px]"
                  style={{ background: 'var(--surface-3)', color: 'var(--brand)' }}
                >
                  {activeConnName}
                </span>
              </>
            )}
            {activeDb && (
              <>
                <ChevronRight size={12} style={{ color: 'var(--text-3)' }} className="hidden md:block" />
                <span className="hidden md:inline text-xs truncate" style={{ color: 'var(--text-2)' }}>
                  {activeDb}
                </span>
              </>
            )}
            {activeCol && (
              <>
                <ChevronRight size={12} style={{ color: 'var(--text-3)' }} className="hidden sm:block" />
                <span className="hidden sm:inline text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>
                  {activeCol}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {activeConnectionId && activeDb && activeCol && (
              <button
                onClick={() => setShowIndexes(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors hover:bg-white/5"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                title="View indexes"
              >
                <ListTree size={12} />
                <span className="hidden sm:inline">Indexes</span>
              </button>
            )}
            <button
              onClick={() => setShowConnMgr(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              <Plug size={12} />
              <span className="hidden sm:inline">Connections</span>
            </button>
            <button
              onClick={toggle}
              className="p-2 rounded transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-3)' }}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>

        {/* Query bar – only shown when a collection is active */}
        {activeConnectionId && activeDb && activeCol && (
          <QueryBar key={`${activeDb}.${activeCol}`} query={query} onChange={setQuery} />
        )}

        {/* Main content area */}
        <main className="flex-1 overflow-auto">
          {activeConnectionId && activeDb && activeCol ? (
            <div className="p-4">
              <DocumentTable
                connectionId={activeConnectionId}
                database={activeDb}
                collection={activeCol}
                query={query}
              />
            </div>
          ) : (
            <EmptyState
              connected={!!activeConnectionId}
              connName={activeConnName}
              onConnect={() => setShowConnMgr(true)}
            />
          )}
        </main>
      </div>

      {showConnMgr && (
        <ConnectionManager
          currentConnectionId={activeConnectionId}
          onConnect={handleConnect}
          onClose={() => activeConnectionId ? setShowConnMgr(false) : undefined}
          canClose={!!activeConnectionId}
        />
      )}

      {showIndexes && activeConnectionId && activeDb && activeCol && (
        <IndexViewer
          connectionId={activeConnectionId}
          database={activeDb}
          collection={activeCol}
          onClose={() => setShowIndexes(false)}
        />
      )}
    </div>
  )
}

function EmptyState({
  connected,
  connName,
  onConnect,
}: {
  connected: boolean
  connName: string | null
  onConnect: () => void
}) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-5 p-8"
      style={{ color: 'var(--text-3)' }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <Database size={28} strokeWidth={1.2} style={{ color: 'var(--brand)' }} />
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-medium" style={{ color: 'var(--text-1)' }}>
          {connected ? `Connected to ${connName}` : 'No connection'}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {connected
            ? 'Select a collection from the sidebar to begin'
            : 'Connect to a MongoDB instance to get started'}
        </p>
      </div>
      {!connected && (
        <button
          onClick={onConnect}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: 'var(--brand)', color: '#fff' }}
        >
          <Plug size={14} />
          Manage Connections
        </button>
      )}
    </div>
  )
}
