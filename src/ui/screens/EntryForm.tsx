import { useState } from 'react'
import { SATISFACTION_MAX } from '../../shared/scales'
import type { EventInput, EventKind, Partner, TideEvent } from '../../shared/types'
import { Icon } from '../components/Icon'
import { RatingRow, Segmented, Sheet, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { formDate, today } from '../lib/dates'
import { INITIATORS, KINDS, PROTECTIONS, kindInfo } from '../lib/entries'

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

const blank = (kind: EventKind, date: string): EventInput => ({
  kind,
  occurredOn: date,
  occurredTime: null,
  satisfaction: null,
  orgasm: null,
  note: null,
  partnerId: null,
  initiator: null,
  protection: null
})

/** New entry / Edit entry (screen 3): everything but the kind is optional. */
export function EntryForm({
  existing,
  kind,
  date,
  onClose,
  onSaved
}: {
  existing?: TideEvent
  kind?: EventKind
  date?: string
  onClose: () => void
  onSaved: (event: TideEvent) => void
}) {
  const [form, setForm] = useState<EventInput>(existing ?? blank(kind ?? 'sex', date ?? today()))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState<string | null>(null)
  const [partnersVersion, setPartnersVersion] = useState(0)
  const { data: allPartners } = useLoad(() => api('partners.list', true), [partnersVersion])
  const set = (patch: Partial<EventInput>) => setForm((current) => ({ ...current, ...patch }))

  const info = kindInfo(form.kind)
  const rated = form.kind === 'sex' || form.kind === 'masturbation'
  const partnered = form.kind === 'sex'
  // Archived labels stay visible only on the entry that already has one.
  const partners = (allPartners ?? []).filter((p: Partner) => !p.archived || p.id === form.partnerId)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = existing ? await api('events.update', existing.id, form) : await api('events.create', form)
      onSaved(saved)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save')
      setSaving(false)
    }
  }

  const addLabel = async () => {
    if (newLabel === null) return
    try {
      const partner = await api('partners.create', newLabel)
      setNewLabel(null)
      setPartnersVersion((v) => v + 1)
      set({ partnerId: partner.id })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the label')
    }
  }

  return (
    <Sheet label={existing ? 'Edit entry' : 'New entry'} onClose={onClose}>
      <header className="sheet-header">
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
        <h1>{existing ? 'Edit entry' : 'New entry'}</h1>
        <button type="button" className="link strong" onClick={() => void save()} disabled={saving}>
          Save
        </button>
      </header>

      <div className="sheet-body">
        <div className="kind-grid" role="radiogroup" aria-label="What to log">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={form.kind === k.kind}
              className={`kind-tile ${k.partnered ? 'terracotta' : 'teal'} ${form.kind === k.kind ? 'on' : ''}`}
              onClick={() => set({ kind: k.kind })}
            >
              <Icon name={k.icon} size={20} />
              <span>{k.label}</span>
            </button>
          ))}
        </div>

        <div className="field-pair">
          <label className="field-button grow3">
            <span className="field-label">Date</span>
            <span className="field-value accent">{formDate(form.occurredOn)}</span>
            <input
              type="date"
              className="field-native"
              value={form.occurredOn}
              max={today()}
              required
              onChange={(event) => event.target.value && set({ occurredOn: event.target.value })}
            />
          </label>
          <label className="field-button grow2">
            <span className="field-label">Time</span>
            <span className={`field-value ${form.occurredTime ? '' : 'muted'}`}>{form.occurredTime ?? '+ add'}</span>
            <input
              type="time"
              className="field-native"
              value={form.occurredTime ?? ''}
              onChange={(event) => set({ occurredTime: event.target.value || null })}
            />
          </label>
          {form.occurredTime && (
            <button type="button" className="icon-button" aria-label="Clear time" onClick={() => set({ occurredTime: null })}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        {partnered && (
          <div className="inline-field">
            <span className="inline-label">Partner</span>
            <div className="chips">
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip terracotta ${form.partnerId === p.id ? 'on' : ''}`}
                  aria-pressed={form.partnerId === p.id}
                  onClick={() => set({ partnerId: form.partnerId === p.id ? null : p.id })}
                >
                  {p.label}
                </button>
              ))}
              {newLabel === null ? (
                <button type="button" className="chip dashed" onClick={() => setNewLabel('')}>
                  + New
                </button>
              ) : (
                <form
                  className="new-label"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void addLabel()
                  }}
                >
                  <input
                    autoFocus
                    aria-label="New partner label"
                    placeholder="Nickname"
                    maxLength={24}
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                  />
                  <button type="submit" className="chip on terracotta">
                    Add
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {rated && (
          <section className="field-block">
            <div className="card-head">
              <h2 className="label">Satisfaction</h2>
              <span className="muted small">optional</span>
            </div>
            <RatingRow
              label="Satisfaction"
              max={SATISFACTION_MAX}
              value={form.satisfaction}
              accent={info.partnered ? 'terracotta' : 'teal'}
              onChange={(satisfaction) => set({ satisfaction })}
            />
          </section>
        )}

        {rated && (
          <div className="card rows-card">
            <div className="seg-row">
              <span className="seg-label">Orgasm</span>
              <Segmented
                label="Orgasm"
                size="small"
                clearable
                options={YES_NO}
                value={form.orgasm === null ? null : form.orgasm ? 'yes' : 'no'}
                onChange={(value) => set({ orgasm: value === null ? null : value === 'yes' })}
              />
            </div>
            {partnered && (
              <div className="seg-row">
                <span className="seg-label">Initiated</span>
                <Segmented label="Initiated by" size="small" clearable options={INITIATORS} value={form.initiator} onChange={(initiator) => set({ initiator })} />
              </div>
            )}
            {partnered && (
              <div className="seg-row">
                <span className="seg-label">Protection</span>
                <Segmented label="Protection" size="small" clearable options={PROTECTIONS} value={form.protection} onChange={(protection) => set({ protection })} />
              </div>
            )}
          </div>
        )}

        <textarea
          className="note"
          rows={2}
          aria-label="Note"
          placeholder="Note — anything worth remembering"
          value={form.note ?? ''}
          onChange={(event) => set({ note: event.target.value })}
        />

        {error && <p className="error-text">{error}</p>}
        <button type="button" className="button primary push-bottom" onClick={() => void save()} disabled={saving}>
          {existing ? 'Save changes' : 'Save entry'}
        </button>
      </div>
    </Sheet>
  )
}
