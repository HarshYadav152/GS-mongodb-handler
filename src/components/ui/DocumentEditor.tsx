'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Save, Copy, Check, AlertCircle, Wand2 } from 'lucide-react'

interface Props {
  document: Record<string, unknown>
  mode: 'insert' | 'edit'
  onSave: (doc: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

const EDITOR_FONT   = "'JetBrains Mono', 'Fira Code', monospace"
const EDITOR_SIZE   = 13
const EDITOR_LINE_H = 1.6  // unitless
const LINE_PX       = EDITOR_SIZE * EDITOR_LINE_H   // ~20.8 px
const GUTTER_W      = 48                             // px

export default function DocumentEditor({ document: doc, mode, onSave, onClose }: Props) {
  // Safe as a lazy initializer (rather than an effect that calls setJson)
  // because the parent passes a `key` keyed to the document/mode, so this
  // component fully remounts — and therefore re-runs this initializer —
  // whenever the target document changes; it never needs to react to a
  // prop change on an already-mounted instance.
  const [json, setJson] = useState(() =>
    JSON.stringify(mode === 'insert' ? (Object.keys(doc).length ? doc : {}) : doc, null, 2)
  )
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [copied,  setCopied]  = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef   = useRef<HTMLDivElement>(null)

  // Focus is a one-off imperative DOM action on mount, not state — a
  // legitimate effect with nothing to suppress.
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  // Keep gutter scroll in sync with textarea scroll
  const syncScroll = useCallback(() => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  function handleChange(val: string) {
    setJson(val)
    setError('')
  }

  function validate(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(json)
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        setError('Document must be a JSON object, not an array or primitive')
        return null
      }
      return parsed
    } catch (e) {
      setError(e instanceof SyntaxError ? e.message : 'Invalid JSON')
      return null
    }
  }

  async function handleSave() {
    const parsed = validate()
    if (!parsed) return
    setSaving(true)
    try {
      await onSave(parsed)
    } finally {
      setSaving(false)
    }
  }

  function handleFormat() {
    try {
      const parsed  = JSON.parse(json)
      const pretty  = JSON.stringify(parsed, null, 2)
      setJson(pretty)
      setError('')
    } catch (e) {
      setError(e instanceof SyntaxError ? e.message : 'Invalid JSON — cannot format')
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(json).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') { e.preventDefault(); handleFormat() }
    if (e.key === 'Escape') { onClose() }

    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta    = textareaRef.current!
      const start = ta.selectionStart
      const end   = ta.selectionEnd
      const next  = json.slice(0, start) + '  ' + json.slice(end)
      setJson(next)
      requestAnimationFrame(() => {
        ta.selectionStart = start + 2
        ta.selectionEnd   = start + 2
      })
    }
  }

  const lineCount = json.split('\n').length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl rounded-xl border flex flex-col animate-fade-in"
        style={{
          background:  'var(--surface-1)',
          borderColor: 'var(--border)',
          boxShadow:   '0 24px 64px rgba(0,0,0,0.5)',
          height:      'min(680px, calc(100vh - 64px))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
              {mode === 'insert' ? 'Insert Document' : 'Edit Document'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {mode === 'edit'
                ? 'Non-_id fields replaced via $set on save'
                : 'Enter a valid JSON object'}&nbsp;·&nbsp;
              <kbd style={{ background: 'var(--surface-3)', color: 'var(--text-3)', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>⌘S</kbd>
              {' '}save&nbsp;·&nbsp;
              <kbd style={{ background: 'var(--surface-3)', color: 'var(--text-3)', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>⌘M</kbd>
              {' '}format
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/5 transition-colors" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        {/* ── Editor ── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Gutter + textarea in the same scroll container */}
          <div className="flex-1 flex overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            {/* Line-number gutter — scrolls via JS in sync with textarea */}
            <div
              ref={gutterRef}
              aria-hidden
              style={{
                width:        `${GUTTER_W}px`,
                flexShrink:   0,
                overflowY:    'hidden',
                paddingTop:   '12px',
                paddingBottom:'12px',
                borderRight:  '1px solid var(--border)',
                fontFamily:   EDITOR_FONT,
                fontSize:     `${EDITOR_SIZE}px`,
                lineHeight:   EDITOR_LINE_H,
                color:        'var(--text-3)',
                textAlign:    'right',
                userSelect:   'none',
                pointerEvents:'none',
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div
                  key={i}
                  style={{ paddingRight: '8px', lineHeight: `${LINE_PX}px`, height: `${LINE_PX}px` }}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* The textarea */}
            <textarea
              ref={textareaRef}
              value={json}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={syncScroll}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="flex-1 resize-none outline-none"
              style={{
                background:   'transparent',
                color:        'var(--text-1)',
                fontFamily:   EDITOR_FONT,
                fontSize:     `${EDITOR_SIZE}px`,
                lineHeight:   EDITOR_LINE_H,
                padding:      '12px 16px',
                border:       'none',
                overflowY:    'auto',
              }}
            />
          </div>

          {/* Error bar */}
          {error && (
            <div
              className="flex items-center gap-2 px-4 py-2 shrink-0 border-t"
              style={{ borderColor: 'rgba(248,81,73,0.4)', background: 'rgba(248,81,73,0.07)' }}
            >
              <AlertCircle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              <span className="text-xs font-mono break-all" style={{ color: 'var(--danger)' }}>{error}</span>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex gap-2">
            <FooterBtn onClick={handleCopy} icon={copied ? <Check size={12} style={{ color: 'var(--brand)' }} /> : <Copy size={12} />}>
              {copied ? 'Copied!' : 'Copy'}
            </FooterBtn>
            <FooterBtn onClick={handleFormat} icon={<Wand2 size={12} />}>
              Format
            </FooterBtn>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-3)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)', color: '#fff' }}
            >
              {saving
                ? <><SpinIcon /> Saving…</>
                : <><Save size={12} /> Save</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FooterBtn({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs border transition-all hover:bg-white/5"
      style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
    >
      {icon}
      {children}
    </button>
  )
}

function SpinIcon() {
  return (
    <svg className="spin-slow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  )
}
