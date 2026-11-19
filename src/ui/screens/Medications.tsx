import { useState } from 'react'
import type { Medication, MedicationInput, Regimen } from '../../shared/types'
import { Icon } from '../components/Icon'
import { ConfirmSheet, Segmented, Sheet, Switch, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { hours, REGIMENS } from '../lib/cycle'
import { shortDate, today as todayKey } from '../lib/dates'

/** Settings → Medications (phase 6, T6): the courses, current first. */
export function MedicationSettings({ version, onEdit }: { version: number; onEdit: (id: string | null) => void }) {
  const today = todayKey()
  const { data: medications } = useLoad(() => api('medications.list', today), [today, version])
  return (
    <section className="group">
      <h2 className="label">Medications</h2>
      <div className="card list-card">
        {(medications ?? []).map((m) => (
          <button key={m.id} type="button" className="row" onClick={() => onEdit(m.id)}>
            <span className="row-text">
              <span className={`row-title ${m.active ? '' : 'muted'}`}>{m.name}</span>
              <span className="row-sub">{medicationSummary(m)}</span>
            </span>
            <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
          </button>
        ))}
        <button type="button" className="row" onClick={() => onEdit(null)}>
          <span className="row-text">
            <span className="row-title accent">Add medication</span>
          </span>
        </button>
      </div>
    </section>
  )
}

function medicationSummary(m: Medication): string {
  const parts: string[] = []
  if (m.isContraceptive) parts.push(m.regimen ? `Contraceptive · ${REGIMENS.find((r) => r.value === m.regimen)?.label.toLowerCase()}` : 'Contraceptive')
  if (m.intervalHours) parts.push(`every ${hours(m.intervalHours)}`)
  if (!m.active) parts.push(m.endedOn && m.endedOn < todayKey() ? `ended ${shortDate(m.endedOn)}` : `from ${shortDate(m.startedOn)}`)
  else parts.push(`since ${shortDate(m.startedOn)}`)
  if (m.source === 'health') parts.push('from Apple Health')
  return parts.join(' · ')
}

const EMPTY: MedicationInput = {
  name: '',
  isContraceptive: false,
  regimen: null,
  startedOn: todayKey(),
  endedOn: null,
  intervalHours: null,
  delayWindowHours: null,
  usualTimeFrom: null,
  usualTimeTo: null,
  note: null
}

const toNumber = (text: string): number | null => (text.trim() === '' ? null : Number(text.replace(',', '.')))

/** Add or edit a course. With an interval it gets a pill card on Today and a dose log. */
export function MedicationSheet({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const today = todayKey()
  const { data: existing } = useLoad(() => (id ? api('medications.list', today).then((all) => all.find((m) => m.id === id) ?? null) : Promise.resolve(null)), [id])
  if (id && existing === undefined) return null
  return <MedicationForm existing={existing ?? null} onClose={onClose} onSaved={onSaved} />
}

function MedicationForm({ existing, onClose, onSaved }: { existing: Medication | null; onClose: () => void; onSaved: () => void }) {
  const today = todayKey()
  const [form, setForm] = useState<MedicationInput>(existing ?? EMPTY)
  const [interval, setIntervalText] = useState(existing?.intervalHours?.toString() ?? '')
  const [delay, setDelay] = useState(existing?.delayWindowHours?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const set = (patch: Partial<MedicationInput>) => setForm((f) => ({ ...f, ...patch }))

  const save = async () => {
    const input: MedicationInput = { ...form, intervalHours: toNumber(interval), delayWindowHours: toNumber(delay) }
    try {
      if (existing) await api('medications.update', existing.id, input, today)
      else await api('medications.create', input, today)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save')
    }
  }
  const title = existing ? 'Medication' : 'New medication'

  return (
    <Sheet label={title} onClose={onClose}>
      <header className="sheet-header">
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
        <h1>{title}</h1>
        <button type="button" className="link strong" onClick={() => void save()}>
          Save
        </button>
      </header>
      <div className="sheet-body">
        <input className="text-input" aria-label="Name" placeholder="Name, for example the pill's brand" maxLength={40} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <div className="card rows-card med-rows">
          <div className="seg-row">
            <span className="seg-label">Contraceptive</span>
            <Switch label="Contraceptive" on={form.isContraceptive} onChange={() => set({ isContraceptive: !form.isContraceptive })} />
          </div>
          {form.isContraceptive && (
            <div className="seg-row">
              <span className="seg-label">Regimen</span>
              <Segmented<Regimen> label="Regimen" size="small" clearable options={REGIMENS} value={form.regimen} onChange={(regimen) => set({ regimen })} />
            </div>
          )}
        </div>
        <div className="field-pair">
          <label className="field-button grow2">
            <span className="field-label">Started</span>
            <span className="field-value">{shortDate(form.startedOn)}</span>
            <input type="date" className="field-native" value={form.startedOn} onChange={(e) => e.target.value && set({ startedOn: e.target.value })} />
          </label>
          <label className="field-button grow2">
            <span className="field-label">Ended</span>
            <span className={`field-value ${form.endedOn ? '' : 'muted'}`}>{form.endedOn ? shortDate(form.endedOn) : 'still taking'}</span>
            <input type="date" className="field-native" value={form.endedOn ?? ''} onChange={(e) => set({ endedOn: e.target.value || null })} />
          </label>
          {form.endedOn && (
            <button type="button" className="icon-button" aria-label="Clear end date" onClick={() => set({ endedOn: null })}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <div className="card rows-card med-rows">
          <label className="seg-row">
            <span className="seg-label">Every</span>
            <span className="unit-input">
              <input inputMode="decimal" aria-label="Hours between doses" placeholder="—" value={interval} onChange={(e) => setIntervalText(e.target.value)} />
              hours
            </span>
          </label>
          <label className="seg-row">
            <span className="seg-label">Allowed delay</span>
            <span className="unit-input">
              <input inputMode="decimal" aria-label="Allowed delay in hours" placeholder="—" value={delay} disabled={interval.trim() === ''} onChange={(e) => setDelay(e.target.value)} />
              hours
            </span>
          </label>
          <div className="seg-row">
            <span className="seg-label">Usual time</span>
            <span className="unit-input">
              <input type="time" aria-label="Usual time from" value={form.usualTimeFrom ?? ''} onChange={(e) => set({ usualTimeFrom: e.target.value || null })} />
              –
              <input type="time" aria-label="Usual time to" value={form.usualTimeTo ?? ''} onChange={(e) => set({ usualTimeTo: e.target.value || null })} />
            </span>
          </div>
        </div>
        <p className="muted small">
          With hours between doses, the pill gets a card on Today and a dose log. The allowed delay comes from the leaflet: Tide marks a dose late when the time since the
          previous one is longer than both together, and gives no medical advice. The usual time describes days before the dose log started.
        </p>
        <textarea className="note" rows={2} aria-label="Note" placeholder="Note — dose changes and so on" value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
        {error && <p className="error-text">{error}</p>}
        {existing && (
          <button type="button" className="button secondary danger-text" onClick={() => setConfirming(true)}>
            Delete medication
          </button>
        )}
      </div>
      {confirming && existing && (
        <ConfirmSheet
          title="Delete this medication?"
          message="Its dose log is deleted too, and it no longer shows on past entries. To stop it, set an end date instead."
          confirm="Delete medication"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void api('medications.delete', existing.id).then(onSaved)}
        />
      )}
    </Sheet>
  )
}
