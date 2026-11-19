import { useState } from 'react'
import type { CycleDay, LoggedFlow, PillStatus, SymptomTag } from '../../shared/types'
import { Icon } from '../components/Icon'
import { Sheet, SheetHeader, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { duration, FLOW_OPTIONS, phoneZone, SYMPTOM_OPTIONS } from '../lib/cycle'
import type { Navigate } from '../navigation'

/** Pill cards on Today (T13): one row per tracked course — what is due, Taken, or Taken at another time. */
export function PillCards({ version, navigate, onChanged }: { version: number; navigate: Navigate; onChanged: () => void }) {
  const zone = phoneZone()
  const { data: statuses } = useLoad(() => api('pills.today', zone), [version, zone])
  const [pickingTime, setPickingTime] = useState<PillStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const take = async (status: PillStatus, takenAt: string | null) => {
    try {
      await api('pills.take', { medicationId: status.medication.id, takenAt, timeZone: zone })
      setError(null)
      setPickingTime(null)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save')
    }
  }

  if (!statuses?.length) return null
  return (
    <>
      {statuses.map((status) => (
        <section key={status.medication.id} className="card pill-card">
          <button type="button" className="pill-open" onClick={() => navigate({ type: 'pills', medicationId: status.medication.id })}>
            <span className="badge teal" style={{ width: 36, height: 36 }}>
              <Icon name="pill" size={18} />
            </span>
            <span className="row-text">
              <span className="row-title">{status.medication.name}</span>
              <PillLine status={status} />
            </span>
          </button>
          {!status.takenToday && (
            <>
              <button type="button" className="button small-button" onClick={() => void take(status, null)}>
                Taken
              </button>
              <button type="button" className="icon-button bordered" aria-label="Taken at another time" onClick={() => setPickingTime(status)}>
                <Icon name="clock" size={18} />
              </button>
            </>
          )}
        </section>
      ))}
      {error && <p className="error-text">{error}</p>}
      {pickingTime && <TakenAtSheet status={pickingTime} onClose={() => setPickingTime(null)} onSave={(at) => take(pickingTime, at)} />}
    </>
  )
}

function PillLine({ status }: { status: PillStatus }) {
  const { last, next } = status
  if (status.takenToday && last) {
    return (
      <span className="row-sub teal-text strong">
        Taken {last.localTime}
        {last.intervalMinutes !== null ? ` · ${duration(last.intervalMinutes)} after the previous` : ''}
      </span>
    )
  }
  if (!last || !next) return <span className="row-sub">No dose logged yet</span>
  if (status.overdue) {
    return (
      <span className="row-sub warn-text strong">
        Latest was {next.latestLocal} · last {duration(status.minutesSinceLast ?? 0)} ago
      </span>
    )
  }
  return (
    <span className="row-sub">
      Due {next.dueLocal} · latest {next.latestLocal} · last {duration(status.minutesSinceLast ?? 0)} ago
    </span>
  )
}

/** Local date and time "YYYY-MM-DDTHH:MM" for a datetime-local field. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TakenAtSheet({ status, onClose, onSave }: { status: PillStatus; onClose: () => void; onSave: (takenAt: string) => Promise<void> }) {
  const [value, setValue] = useState(() => localInput(new Date()))
  return (
    <Sheet label="Taken at" onClose={onClose}>
      <SheetHeader title="Taken at" onClose={onClose} />
      <div className="sheet-body">
        <p className="muted">{status.medication.name}</p>
        <input className="text-input" type="datetime-local" aria-label="Time taken" max={localInput(new Date())} value={value} onChange={(e) => setValue(e.target.value)} />
        <p className="muted small">In this phone's time. The interval is counted from the real time of the previous dose, so a flight changes nothing.</p>
        <button type="button" className="button primary" disabled={!value} onClick={() => void onSave(new Date(value).toISOString())}>
          Save dose
        </button>
      </div>
    </Sheet>
  )
}

/** Bleeding on Today (T13, T18): the day's flow — tap the chosen one again to clear it — and symptom tags. */
export function BleedingCard({ day, version, onChanged }: { day: string; version: number; onChanged: () => void }) {
  const { data } = useLoad(() => api('cycle.day', day), [day, version])
  const shown = data?.date === day ? data : undefined

  const setFlow = async (flow: LoggedFlow | null) => {
    await api('cycle.setFlow', day, flow)
    onChanged()
  }
  const toggle = async (tag: SymptomTag) => {
    const current = shown?.symptoms ?? []
    await api('cycle.setSymptoms', day, current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag])
    onChanged()
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Bleeding</h2>
        <span className={`small ${shown && shown.startsCycle ? 'berry-text strong' : 'muted'}`}>{shown ? caption(shown) : ''}</span>
      </div>
      <div className="flow-grid" role="radiogroup" aria-label="Flow">
        {FLOW_OPTIONS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={shown?.flow === f.value}
            className={`flow-option ${shown?.flow === f.value ? 'on' : ''}`}
            onClick={() => void setFlow(shown?.flow === f.value ? null : f.value)}
          >
            <i className={`flow-swatch ${f.value}`} />
            <span>{f.label}</span>
          </button>
        ))}
      </div>
      <div className="chips symptoms" aria-label="Symptoms">
        {SYMPTOM_OPTIONS.map((s) => {
          const on = shown?.symptoms.includes(s.value) ?? false
          return (
            <button key={s.value} type="button" className={`chip small-chip ${on ? 'on berry' : ''}`} aria-pressed={on} onClick={() => void toggle(s.value)}>
              {s.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function caption(day: CycleDay): string {
  if (day.flow === null) return day.cycleDay ? `Not recorded · cycle day ${day.cycleDay}` : 'Not recorded'
  if (day.flow === 'none') return 'No bleeding'
  if (day.flow === 'spotting') return 'Spotting — does not start a cycle'
  if (day.startsCycle) return 'Day 1 — starts a new cycle'
  return day.cycleDay ? `Day ${day.cycleDay} of the cycle` : 'Bleeding'
}
