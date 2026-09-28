'use client'
import { useState } from 'react'
import { Filter, ArrowUpDown, Hash, Play, RotateCcw } from 'lucide-react'
import type { QueryState } from '@/components/layout/AppShell'

interface Props {
  query: QueryState
  onChange: (q: QueryState) => void
}

function isDefaultQuery(q: QueryState) {
  return q.filter === '{}' && q.sort === '{}' && q.limit === 20 && q.skip === 0
}

export default function QueryBar({ query, onChange }: Props) {
  // No effect needed to keep this in sync with the `query` prop: the
  // parent renders this component with `key={db+collection}`, so React
  // remounts it (re-running this initializer) whenever the active
  // collection changes, instead of updating an already-mounted instance.
  const [local, setLocal] = useState(query)
  const [filterError, setFilterError] = useState('')
  const [sortError, setSortError] = useState('')

  function validate(str: string): boolean {
    if (!str.trim() || str.trim() === '{}') return true
    try {
      JSON.parse(str)
      return true
    } catch {
      return false
    }
  }

  function handleApply() {
    let valid = true
    if (!validate(local.filter)) {
      setFilterError('Invalid JSON')
      valid = false
    } else {
      setFilterError('')
    }
    if (!validate(local.sort)) {
      setSortError('Invalid JSON')
      valid = false
    } else {
      setSortError('')
    }
    if (valid) onChange({ ...local, skip: 0 })
  }

  function handleReset() {
    const defaults: QueryState = { filter: '{}', sort: '{}', limit: 20, skip: 0 }
    setLocal(defaults)
    setFilterError('')
    setSortError('')
    onChange(defaults)
  }

  const isDirty = !isDefaultQuery(local)
  const hasActiveFilters = !isDefaultQuery(query)

  return (
    <div
      className="flex items-start gap-2 px-4 py-2.5 border-b flex-wrap"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      {/* Filter */}
      <div className="flex flex-col gap-0.5 flex-1 min-w-48">
        <div className="flex items-center gap-1.5">
          <Filter size={11} style={{ color: hasActiveFilters && query.filter !== '{}' ? 'var(--brand)' : 'var(--text-3)' }} />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Filter</span>
        </div>
        <input
          value={local.filter}
          onChange={(e) => {
            setLocal((p) => ({ ...p, filter: e.target.value }))
            setFilterError('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleApply()}
          placeholder='{"field": "value"}'
          spellCheck={false}
          className="px-2 py-1.5 rounded text-xs font-mono border outline-none transition-colors"
          style={{
            background: 'var(--surface-2)',
            borderColor: filterError ? 'var(--danger)' : 'var(--border)',
            color: 'var(--text-1)',
            minWidth: 0,
          }}
          onFocus={(e) => { if (!filterError) e.target.style.borderColor = 'var(--brand)' }}
          onBlur={(e) => { if (!filterError) e.target.style.borderColor = 'var(--border)' }}
        />
        {filterError && (
          <span className="text-xs" style={{ color: 'var(--danger)', fontSize: '10px' }}>
            {filterError}
          </span>
        )}
      </div>

      {/* Sort */}
      <div className="flex flex-col gap-0.5 w-44">
        <div className="flex items-center gap-1.5">
          <ArrowUpDown size={11} style={{ color: query.sort !== '{}' ? 'var(--brand)' : 'var(--text-3)' }} />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Sort</span>
        </div>
        <input
          value={local.sort}
          onChange={(e) => {
            setLocal((p) => ({ ...p, sort: e.target.value }))
            setSortError('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleApply()}
          placeholder='{"_id": -1}'
          spellCheck={false}
          className="px-2 py-1.5 rounded text-xs font-mono border outline-none transition-colors"
          style={{
            background: 'var(--surface-2)',
            borderColor: sortError ? 'var(--danger)' : 'var(--border)',
            color: 'var(--text-1)',
          }}
          onFocus={(e) => { if (!sortError) e.target.style.borderColor = 'var(--brand)' }}
          onBlur={(e) => { if (!sortError) e.target.style.borderColor = 'var(--border)' }}
        />
        {sortError && (
          <span className="text-xs" style={{ color: 'var(--danger)', fontSize: '10px' }}>
            {sortError}
          </span>
        )}
      </div>

      {/* Limit */}
      <div className="flex flex-col gap-0.5 w-20">
        <div className="flex items-center gap-1.5">
          <Hash size={11} style={{ color: 'var(--text-3)' }} />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Limit</span>
        </div>
        <input
          type="number"
          value={local.limit}
          onChange={(e) =>
            setLocal((p) => ({
              ...p,
              limit: Math.min(1000, Math.max(1, Number(e.target.value) || 20)),
            }))
          }
          onKeyDown={(e) => e.key === 'Enter' && handleApply()}
          min={1}
          max={1000}
          className="px-2 py-1.5 rounded text-xs font-mono border outline-none transition-colors"
          style={{
            background: 'var(--surface-2)',
            borderColor: 'var(--border)',
            color: 'var(--text-1)',
          }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--brand)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>

      {/* Actions */}
      <div className="flex items-end gap-1.5 pb-0.5 self-end">
        {hasActiveFilters && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
            title="Reset filters"
          >
            <RotateCcw size={11} />
          </button>
        )}
        <button
          onClick={handleApply}
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:opacity-90"
          style={{ background: 'var(--brand)', color: '#fff' }}
          title={isDirty ? 'You have unapplied changes' : undefined}
        >
          <Play size={11} />
          Run
          {isDirty && (
            <span
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
              style={{ background: '#fff', boxShadow: '0 0 0 2px var(--brand)' }}
            />
          )}
        </button>
      </div>
    </div>
  )
}
