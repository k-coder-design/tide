import { useState } from 'react'
import type { PillDose, PillLog as Log } from '../../shared/types'
import { Icon } from '../components/Icon'
import { ConfirmSheet, Segmented, Sheet, SheetHeader, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { duration, hours, phoneZone, REGIMENS, zoneCity } from '../lib/cycle'
import { addDays, dayMonth, shortDate, today as todayKey } from '../lib/dates'

/** Pill log (screen 8 on the canvas, T15): the course, the next pill in local time, every dose with its real interval. */
export function PillLogPage({
  medicationId,
  version,
  onBack,
  onEdit,
  onChanged
}: {
  medicationId: string
  version: number
  onBack: () => void
  onEdit: () => void
  onChanged: () => void
}) {
  const zone = phoneZone()
  const { data: log, error } = useLoad(() => api('pills.log', medicationId, zone), [medicationId, zone, version])
  const [logging, setLogging] = useState(false)
  const [removing, setRemoving] = useState<PillDose | null>(null)

  if (error || !log) {
    return (
      <div className="page">
        <button type="button" className="back" onClick={onBack}>
          <Icon name="back" size={20} strokeWidth={2} /> Back
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    )
  }
  const { medication, next } = log.status
  const today = todayKey()
  const facts = [
    medication.regimen ? REGIMENS.find((r) => r.value === medication.regimen)?.label : null,
    medication.intervalHours ? `every ${hours(medication.intervalHours)}` : null,
    medication.delayWindowHours ? `allowed delay ${hours(medication.delayWindowHours)} (from the leaflet)` : null
  ].filter(Boolean)
  const before = historyNote(log)

  return (
    <div className="page pill-log">
      <button type="button" className="back" onClick={onBack}>
        <Icon name="back" size={20} strokeWidth={2} /> Back
      </button>
      <h1>Pill log</h1>
      <section className="card course-card">
        <div className="card-head">
          <h2>{medication.name}</h2>
          <button type="button" className="link strong" onClick={onEdit}>
            Edit
          </button>
        </div>
        <p className="muted small">{facts.join(' · ') || 'No interval set'}</p>
      </section>
      {next && (
        <section className="next-pill">
          <span className="next-label">Next pill · local time, {zoneCity(zone)}</span>
          <span className="next-time">
            {next.dueDate === today ? '' : `${dayLabel(next.dueDate, today)} `}
            {next.dueLocal} <small>· latest {next.latestDate === next.dueDate ? '' : `${dayLabel(next.latestDate, today)} `}{next.latestLocal}</small>
          </span>
          <span className="small">
            {hours(medication.intervalHours ?? 0)} after the last dose. After a flight it is shown in the new local time.
          </span>
        </section>
      )}
      <section className="group">
        <h2 className="label">Doses</h2>
        <div className="card list-card dose-list">
          {log.doses.length === 0 && <p className="empty-row muted small">No doses logged yet.</p>}
          {log.doses.map((dose, i) => (
            <button key={dose.id} type="button" className="row" onClick={() => setRemoving(dose)}>
              <span className={`badge ${dose.lateMinutes !== null || dose.status === 'missed' ? 'warn' : 'teal'}`} style={{ width: 32, height: 32 }}>
                <Icon name={dose.status === 'missed' ? 'close' : dose.lateMinutes !== null ? 'alert' : 'check'} size={16} strokeWidth={2.2} />
              </span>
              <span className="row-text">
                <span className="row-title">
                  {dayLabel(dose.localDate, today)} · {dose.status === 'missed' ? 'missed' : `${dose.localTime} ${zoneCity(dose.timeZone)}`}
                </span>
                <span className="row-sub">{doseNote(dose, i === log.doses.length - 1)}</span>
              </span>
              <span className={`row-meta strong ${dose.lateMinutes !== null ? 'warn-text' : 'teal-text'}`}>
                {dose.intervalMinutes === null ? '—' : duration(dose.intervalMinutes)}
              </span>
            </button>
          ))}
        </div>
      </section>
      {before && (
        <section className="history-note">
          <b>Before {dayMonth(before.until)}</b>
          <span className="muted small">{before.text}</span>
        </section>
      )}
      <button type="button" className="button primary push-bottom" onClick={() => setLogging(true)}>
        Log a dose
      </button>
      {logging && (
        <LogDoseSheet
          medicationId={medicationId}
          zone={zone}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false)
            onChanged()
          }}
        />
      )}
      {removing && (
        <ConfirmSheet
          title="Delete this dose?"
          message={`${dayLabel(removing.localDate, today)}${removing.localTime ? ` · ${removing.localTime}` : ' · missed'}. Log it again with the right time if it was wrong.`}
          confirm="Delete dose"
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void api('pills.delete', removing.id).then(() => {
              setRemoving(null)
              onChanged()
            })
          }
        />
      )}
    </div>
  )
}

function doseNote(dose: PillDose, first: boolean): string {
  if (dose.status === 'missed') return 'Missed'
  if (dose.previousElsewhere) return `Time zone changed · previous dose ${dose.previousElsewhere.localTime} ${zoneCity(dose.previousElsewhere.timeZone)}`
  if (dose.lateMinutes !== null) return `late by ${duration(dose.lateMinutes)}`
  if (dose.intervalMinutes === null) return first ? 'first dose logged in Tide' : 'after a missed dose'
  return 'after the previous dose'
}

/** Days of the course before the first logged dose have no dose log (T12): say so, never invent doses. */
function historyNote(log: Log): { until: string; text: string } | null {
  const { medication } = log.status
  const until = log.firstLoggedOn ?? todayKey()
  if (medication.startedOn >= until) return null
  const usual = medication.usualTimeFrom ? `usual time ${medication.usualTimeFrom}${medication.usualTimeTo && medication.usualTimeTo !== medication.usualTimeFrom ? `–${medication.usualTimeTo}` : ''}` : 'time unknown'
  const source = medication.source === 'health' ? 'Course imported from Apple Health' : `Course from ${shortDate(medication.startedOn)}`
  return { until, text: `${source} · ${usual} · no dose log, left out of interval and lateness figures` }
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  if (date === addDays(today, 1)) return 'Tomorrow'
  return shortDate(date)
}

const DOSE_KINDS = [
  { value: 'taken', label: 'Taken' },
  { value: 'missed', label: 'Missed' }
] as const

function LogDoseSheet({ medicationId, zone, onClose, onSaved }: { medicationId: string; zone: string; onClose: () => void; onSaved: () => void }) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const nowInput = `${todayKey()}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  const [kind, setKind] = useState<'taken' | 'missed'>('taken')
  const [takenAt, setTakenAt] = useState(nowInput)
  const [missedOn, setMissedOn] = useState(todayKey())
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    try {
      if (kind === 'taken') await api('pills.take', { medicationId, takenAt: new Date(takenAt).toISOString(), timeZone: zone })
      else await api('pills.miss', { medicationId, localDate: missedOn, timeZone: zone })
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save')
    }
  }

  return (
    <Sheet label="Log a dose" onClose={onClose}>
      <SheetHeader title="Log a dose" onClose={onClose} />
      <div className="sheet-body">
        <Segmented label="Dose" options={DOSE_KINDS} value={kind} onChange={(v) => v && setKind(v)} />
        {kind === 'taken' ? (
          <input className="text-input" type="datetime-local" aria-label="Time taken" max={nowInput} value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
        ) : (
          <input className="text-input" type="date" aria-label="Day missed" max={todayKey()} value={missedOn} onChange={(e) => setMissedOn(e.target.value)} />
        )}
        <p className="muted small">In this phone's time ({zoneCity(zone)}). Tide flags late doses against the allowed delay you set; it gives no medical advice.</p>
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="button primary" disabled={kind === 'taken' ? !takenAt : !missedOn} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Sheet>
  )
}
