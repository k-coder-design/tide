import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TideEvent } from '../../shared/types'
import { entrySummary, kindInfo } from '../lib/entries'
import { Icon, type IconName } from './Icon'

/** A row of choices; tapping the chosen one again clears it when `clearable`. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  clearable = false,
  label,
  size = 'normal'
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onChange: (value: T | null) => void
  clearable?: boolean
  label: string
  size?: 'normal' | 'small'
}) {
  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'on' : ''}
          onClick={() => onChange(clearable && value === option.value ? null : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Buttons from 1 to `max` (desire 1–5, satisfaction 1–10). Tapping the chosen number again clears it. */
export function RatingRow({
  value,
  onChange,
  label,
  max,
  accent = 'teal'
}: {
  value: number | null
  onChange: (value: number | null) => void
  label: string
  max: number
  accent?: 'teal' | 'terracotta'
}) {
  return (
    <div className={`rating ${accent}${max <= 5 ? ' wide' : ''}`} role="radiogroup" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${label} ${n} of ${max}`}
          className={value === n ? 'on' : ''}
          onClick={() => onChange(value === n ? null : n)}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

export function KindBadge({ icon, tone, size = 30 }: { icon: IconName; tone: 'teal' | 'terracotta' | 'berry'; size?: number }) {
  return (
    <span className={`badge ${tone}`} style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.55)} />
    </span>
  )
}

export function EntryRow({ event, onOpen }: { event: TideEvent; onOpen: () => void }) {
  const info = kindInfo(event.kind)
  return (
    <button type="button" className="row" onClick={onOpen}>
      <KindBadge icon={info.icon} tone={info.partnered ? 'terracotta' : 'teal'} />
      <span className="row-text">
        <span className="row-title">{info.label}</span>
        <span className="row-sub">{entrySummary(event)}</span>
      </span>
      {event.occurredTime && <span className="row-meta">{event.occurredTime}</span>}
      <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
    </button>
  )
}

export function CheckinRow({ desire, onOpen }: { desire: number; onOpen: () => void }) {
  return (
    <button type="button" className="row" onClick={onOpen}>
      <KindBadge icon="desire" tone="teal" />
      <span className="row-text">
        <span className="row-title">Desire {desire}</span>
        <span className="row-sub">Daily check-in</span>
      </span>
      <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
    </button>
  )
}

/** An on/off switch, as in iOS Settings. */
export function Switch({ label, on, onChange, disabled = false }: { label: string; on: boolean; onChange: () => void; disabled?: boolean }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} />
}

/** A sheet title with Cancel on the left. */
export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="sheet-header">
      <button type="button" className="link" onClick={onClose}>
        Cancel
      </button>
      <h1>{title}</h1>
      <span className="sheet-header-spacer" />
    </header>
  )
}

/**
 * A full-height sheet sliding over the current screen. Rendered at the end of <body>: on iOS a scrolling screen
 * (-webkit-overflow-scrolling) traps fixed children, and the tab bar would cover the sheet's bottom.
 */
/** `fit` — as tall as its content (a day from a calendar), so the screen behind stays in view. */
export function Sheet({ children, label, onClose, fit = false }: { children: ReactNode; label: string; onClose: () => void; fit?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`sheet ${fit ? 'fit' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <span className="grabber" aria-hidden="true" />
        {children}
      </section>
    </div>,
    document.body
  )
}

/** A small question at the bottom: "Delete this entry?" with the actions. */
export function ConfirmSheet({
  title,
  message,
  confirm,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return createPortal(
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{message}</p>
        <button type="button" className="button danger" onClick={onConfirm}>
          {confirm}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </div>,
    document.body
  )
}

/** Loads data from the core and reloads when `deps` change; keeps the last data while reloading. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    load().then(
      (value) => active && (setData(value), setError(null)),
      (reason: unknown) => active && setError(reason instanceof Error ? reason.message : 'Something went wrong')
    )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error }
}
