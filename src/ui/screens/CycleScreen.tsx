import { useState } from 'react'
import type { CycleInsights, ReportPeriod } from '../../shared/types'
import { Icon } from '../components/Icon'
import { Segmented, Sheet, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { cycleDates, cycleNote } from '../lib/cycle'
import { cycleReportPdf, type ReportParts } from '../lib/cycleReport'
import { longDate, monthCells, monthKey, monthTitle, shiftMonth, today as todayKey } from '../lib/dates'
import { shareFile } from '../lib/share'
import type { Navigate } from '../navigation'
import { BleedingCard } from './CycleCards'

/**
 * The Cycle tab (T35, canvas board 11): the month calendar — a tap on a day edits its bleeding — pills, the menstrual
 * cycles with their averages, a PDF report, and desire next to the cycle. Numbers only, nothing predicted.
 */
export function CycleScreen({ version, navigate, onChanged }: { version: number; navigate: Navigate; onChanged: () => void }) {
  const today = todayKey()
  const { data, error } = useLoad(() => api('insights.cycle', today), [today, version])
  const [editing, setEditing] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)

  return (
    <div className="screen cycle">
      <header className="screen-header">
        <div>
          <p className="caption berry-text">{data?.currentCycleDay ? `Day ${data.currentCycleDay} of the current cycle` : 'Menstrual cycle'}</p>
          <h1>Cycle</h1>
        </div>
      </header>
      {error && <p className="error-text">{error}</p>}
      <CycleCalendar firstMonth={data?.firstMonth ?? null} version={version} onOpenDay={setEditing} />
      {data && data.pills.length > 0 && (
        <div className="card list-card">
          {data.pills.map((p) => (
            <button key={p.medicationId} type="button" className="row" onClick={() => navigate({ type: 'pills', medicationId: p.medicationId })}>
              <span className="badge teal" style={{ width: 32, height: 32 }}>
                <Icon name="pill" size={16} />
              </span>
              <span className="row-text">
                <span className="row-title">{data.pills.length > 1 ? `${p.name}, last 30 days` : 'Pills, last 30 days'}</span>
                <span className="row-sub">
                  {p.onTime} on time · <span className={p.late ? 'warn-text strong' : ''}>{p.late} late</span> · {p.missed} missed
                </span>
              </span>
              <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
            </button>
          ))}
        </div>
      )}
      {data && <CyclesCard data={data} onReport={() => setReporting(true)} />}
      {data && <DesireNote data={data} />}
      {editing && <CycleDaySheet date={editing} version={version} onChanged={onChanged} onClose={() => setEditing(null)} />}
      {reporting && <ReportSheet onClose={() => setReporting(false)} />}
    </div>
  )
}

function CycleCalendar({ firstMonth, version, onOpenDay }: { firstMonth: string | null; version: number; onOpenDay: (date: string) => void }) {
  const today = todayKey()
  const current = monthKey(today)
  const [month, setMonth] = useState(current)
  const { data } = useLoad(() => api('cycle.month', month, today), [month, today, version])
  // Back to the first recorded month, and at least a year back, so older days can still be filled in.
  const year = shiftMonth(current, -12)
  const earliest = firstMonth && firstMonth < year ? firstMonth : year
  const byDate = new Map((data?.month === month ? data.days : []).map((d) => [d.date, d]))
  const summary = data?.month === month ? monthSummary(data.bleedingDays, data.spottingDays, data.cycleStarts) : ''

  return (
    <section className="card calendar cycle-calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="Previous month" disabled={month <= earliest} onClick={() => setMonth(shiftMonth(month, -1))}>
          <Icon name="back" strokeWidth={2} />
        </button>
        <h2>{monthTitle(month)}</h2>
        <button type="button" className="icon-button" aria-label="Next month" disabled={month >= current} onClick={() => setMonth(shiftMonth(month, 1))}>
          <Icon name="forward" strokeWidth={2} />
        </button>
      </div>
      <div className="calendar-grid weekdays" aria-hidden="true">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {monthCells(month).map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />
          const day = byDate.get(date)
          const future = date > today
          const flow = day?.flow && day.flow !== 'none' ? day.flow : ''
          return (
            <button
              key={date}
              type="button"
              disabled={future}
              className={`calendar-cell cycle-cell ${flow} ${day?.startsCycle ? 'starts' : ''} ${date === today ? 'today' : ''} ${future ? 'future' : ''}`}
              aria-label={`${longDate(date)}${day?.flow ? `, ${day.flow}` : ', not recorded'}${day?.startsCycle ? ', first day of a cycle' : ''}${day?.currentCycleDay ? `, cycle day ${day.currentCycleDay}` : ''}`}
              onClick={() => onOpenDay(date)}
            >
              <span>{Number(date.slice(8))}</span>
              <span className="cycle-day-no">{day?.currentCycleDay ?? ''}</span>
            </button>
          )
        })}
      </div>
      <p className="muted small">{summary}</p>
      <div className="legend wrap">
        <span>
          <i className="swatch flow-day spotting" /> Spotting
        </span>
        <span>
          <i className="swatch flow-day light" /> Light
        </span>
        <span>
          <i className="swatch flow-day medium" /> Medium
        </span>
        <span>
          <i className="swatch flow-day heavy" /> Heavy
        </span>
        <span>
          <i className="swatch ring-swatch" /> Cycle start
        </span>
        <span>
          <b className="cycle-day-no">12</b> Day of the current cycle
        </span>
      </div>
    </section>
  )
}

function monthSummary(bleeding: number, spotting: number, starts: string[]): string {
  const parts = [`${bleeding} bleeding ${bleeding === 1 ? 'day' : 'days'}`]
  if (spotting) parts.push(`${spotting} spotting`)
  const dayMonth = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  parts.push(starts.length ? `cycle started ${starts.map(dayMonth).join(' and ')}` : 'no cycle started')
  return parts.join(' · ')
}

/** A day from the calendar: its flow and symptoms, saved at once (the same card as on Today). */
function CycleDaySheet({ date, version, onChanged, onClose }: { date: string; version: number; onChanged: () => void; onClose: () => void }) {
  return (
    <Sheet label={longDate(date)} onClose={onClose} fit>
      <header className="sheet-header">
        <span className="sheet-header-spacer" />
        <h1>{longDate(date)}</h1>
        <button type="button" className="link strong" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="sheet-body">
        <BleedingCard day={date} version={version} onChanged={onChanged} />
        <p className="muted small">Tap the chosen flow again to clear the day. Changes save at once.</p>
      </div>
    </Sheet>
  )
}

function CyclesCard({ data, onReport }: { data: CycleInsights; onReport: () => void }) {
  const [all, setAll] = useState(false)
  if (!data.hasFlow) {
    return (
      <section className="card">
        <h2>Menstrual cycles</h2>
        <p className="muted small">Tap a day in the calendar to record bleeding, or bring your history over once: Settings → Import from Apple Health.</p>
      </section>
    )
  }
  const shown = all ? data.cycles : data.cycles.slice(0, 3)
  const since = data.cycles.at(-1)?.start
  return (
    <section className="card episodes">
      <div className="card-head">
        <h2>Menstrual cycles</h2>
        <span className="muted small">{all && since ? `all ${data.cycles.length} since ${monthTitle(since.slice(0, 7))}` : `last ${Math.min(3, data.cycles.length)}`}</span>
      </div>
      {data.cycles.length === 0 ? (
        <p className="muted small">Only spotting so far — spotting never starts a cycle.</p>
      ) : (
        <>
          <div className="episode-head">
            <span>Cycle</span>
            <span>Bleeding</span>
            <span>Length</span>
          </div>
          <div className={`episode-list ${all ? 'scroll' : ''}`}>
            {shown.map((c) => (
              <div key={c.start} className="episode-row">
                <i className={`flow-swatch ${c.strongest}`} />
                <span className="episode-dates">
                  <b>{cycleDates(c)}</b>
                  <span className="muted">{cycleNote(c)}</span>
                </span>
                <b className="num">
                  {c.bleedingDays}
                  {c.bleedingOngoing ? '+' : ''}
                  <small> d</small>
                </b>
                <b className="num">
                  {c.length}
                  {c.end === null ? '+' : ''}
                  <small> d</small>
                </b>
              </div>
            ))}
          </div>
          <div className="episode-foot muted small">
            {data.averageBleeding !== null && (
              <span>
                Bleeding <b>{days(data.averageBleeding)}</b> avg
              </span>
            )}
            {data.averageCycle !== null && data.cycleRange && (
              <span>
                Cycle <b>{days(data.averageCycle)}</b> avg{data.cycleRange.min !== data.cycleRange.max ? ` (${data.cycleRange.min}–${data.cycleRange.max})` : ''}
              </span>
            )}
          </div>
        </>
      )}
      <div className="button-pair">
        {data.cycles.length > 3 && (
          <button type="button" className="button secondary" onClick={() => setAll(!all)}>
            {all ? 'Show last 3' : `Show all (${data.cycles.length})`}
          </button>
        )}
        <button type="button" className="button berry" onClick={onReport}>
          <Icon name="download" size={16} strokeWidth={2} /> Report
        </button>
      </div>
      <p className="muted tiny">A cycle runs from the first bleeding day to the day before the next one. Spotting never starts a cycle. Averages count finished cycles only.</p>
    </section>
  )
}

/** Desire next to the cycle: averages only, shown when at least two kinds of days have ratings. */
function DesireNote({ data }: { data: CycleInsights }) {
  const { bleeding, spotting, other } = data.desireByFlow
  const parts = [
    bleeding !== null ? ['on bleeding days', bleeding] : null,
    spotting !== null ? ['on spotting days', spotting] : null,
    other !== null ? ['other days', other] : null
  ].filter((p): p is [string, number] => p !== null)
  if (parts.length < 2) return null
  return (
    <section className="cycle-note">
      Desire averages{' '}
      {parts.map(([label, value], i) => (
        <span key={label}>
          {i > 0 ? (i === parts.length - 1 ? ' and ' : ', ') : ''}
          <b>{value.toFixed(1)}</b> {label}
        </span>
      ))}
      .
    </section>
  )
}

const PERIODS: ReadonlyArray<{ value: ReportPeriod; label: string }> = [
  { value: 'last3', label: 'Last 3' },
  { value: 'last6', label: 'Last 6' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' }
]

const PARTS: ReadonlyArray<{ key: keyof ReportParts; title: string; sub: string }> = [
  { key: 'cycles', title: 'Menstrual cycles', sub: 'Start, end, bleeding days, length, averages' },
  { key: 'calendar', title: 'Bleeding calendar', sub: 'Month by month, flow on each day' },
  { key: 'symptoms', title: 'Symptoms', sub: 'How many days each one was recorded' },
  { key: 'pills', title: 'Pills', sub: 'On time, late and missed doses per course' },
  { key: 'desire', title: 'Desire next to the cycle', sub: 'Averages on bleeding, spotting and other days' }
]

/**
 * The cycle report (T35): a PDF drawn on this iPhone and handed to the Share sheet. Made first, shared from a second
 * tap, because iOS opens the Share sheet only right after a tap.
 */
function ReportSheet({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<ReportPeriod>('last6')
  const [parts, setParts] = useState<ReportParts>({ cycles: true, calendar: true, symptoms: true, pills: true, desire: false })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const nothing = !Object.values(parts).some(Boolean)

  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      const today = todayKey()
      const report = await api('reports.cycle', today, period)
      const bytes = await cycleReportPdf(report, parts)
      setFile(new File([bytes as Uint8Array<ArrayBuffer>], `tide-cycle-report-${today}.pdf`, { type: 'application/pdf' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not make the report')
    } finally {
      setBusy(false)
    }
  }
  const share = async () => {
    if (!file) return
    try {
      if (await shareFile(file)) setShared(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not share the report')
    }
  }
  const change = (update: () => void) => {
    update()
    setFile(null)
    setShared(false)
  }

  return (
    <Sheet label="Cycle report" onClose={onClose} fit>
      <header className="sheet-header">
        <button type="button" className="link" onClick={onClose}>
          {shared ? 'Done' : 'Cancel'}
        </button>
        <h1>Cycle report</h1>
        <span className="sheet-header-spacer" />
      </header>
      <div className="sheet-body">
        <Segmented label="Period" options={PERIODS} value={period} onChange={(p) => p && change(() => setPeriod(p))} />
        <div className="card list-card">
          {PARTS.map((p) => (
            <button key={p.key} type="button" className="row" role="checkbox" aria-checked={parts[p.key]} onClick={() => change(() => setParts({ ...parts, [p.key]: !parts[p.key] }))}>
              <span className={`check-box ${parts[p.key] ? 'on' : ''}`}>{parts[p.key] && <Icon name="check" size={14} strokeWidth={3} />}</span>
              <span className="row-text">
                <span className="row-title">{p.title}</span>
                <span className="row-sub">{p.sub}</span>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        {file ? (
          <button type="button" className="button berry" onClick={() => void share()}>
            {shared ? 'Share again…' : 'Save or share…'}
          </button>
        ) : (
          <button type="button" className="button berry" disabled={busy || nothing} onClick={() => void make()}>
            {busy ? 'Making the PDF…' : 'Make PDF'}
          </button>
        )}
        <p className="muted small">The PDF is made on this iPhone and opens in the Share sheet: save it to Files or send it yourself. Tide sends nothing. Facts only, no predictions or medical advice.</p>
      </div>
    </Sheet>
  )
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
