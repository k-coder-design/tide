import { useState } from 'react'
import { DESIRE_MAX } from '../../shared/scales'
import type { EventKind, InsightsBucket, InsightsPeriod, InsightsSpan, LibidoInsights, MonthDay } from '../../shared/types'
import { Icon } from '../components/Icon'
import { EntryRow, RatingRow, Segmented, Sheet, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { longDate, monthCells, monthKey, monthTitle, shiftMonth, today as todayKey } from '../lib/dates'
import { KINDS } from '../lib/entries'
import type { Navigate } from '../navigation'

const PERIODS: ReadonlyArray<{ value: InsightsPeriod; label: string }> = [
  { value: '12w', label: '12 weeks' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: 'Year' }
]

/**
 * The Libido tab (T35, canvas board 12; it replaces Insights): a month calendar shaded by desire with dots for entries —
 * a tap on a day rates desire and opens or adds its entries — then activity, desire and the last four weeks against
 * the four before.
 */
export function LibidoScreen({
  version,
  period,
  onPeriod,
  navigate,
  onChanged
}: {
  version: number
  period: InsightsPeriod
  onPeriod: (period: InsightsPeriod) => void
  navigate: Navigate
  onChanged: () => void
}) {
  const today = todayKey()
  const { data, error } = useLoad(() => api('insights.libido', today, period), [today, period, version])
  const { data: summary } = useLoad(() => api('today.summary', today), [today, version])
  const [open, setOpen] = useState<string | null>(null)
  const week = summary?.week.desireAverage

  return (
    <div className="screen insights">
      <header className="screen-header">
        <div>
          <p className="caption teal-text">{week != null ? `Desire over the last 7 days ${week.toFixed(1)}` : 'Desire and activity'}</p>
          <h1>Libido</h1>
        </div>
      </header>
      <LibidoCalendar version={version} onOpenDay={setOpen} />
      <div className="period-picker">
        <Segmented label="Period" options={PERIODS} value={period} onChange={(p) => p && onPeriod(p)} />
      </div>
      {error && <p className="error-text">{error}</p>}
      {data && !data.hasData && (
        <section className="card">
          <h2>Nothing to chart yet</h2>
          <p className="muted">Log entries and rate desire for a few days — activity, desire and comparisons appear here.</p>
        </section>
      )}
      {data?.hasData && (
        <>
          <ActivityCard data={data} />
          <DesireCard data={data} />
          <CompareCard current={data.compare.current} previous={data.compare.previous} hasFlow={data.hasFlow} />
        </>
      )}
      {open && (
        <LibidoDaySheet
          date={open}
          version={version}
          onChanged={onChanged}
          onClose={() => setOpen(null)}
          onNavigate={(overlay) => {
            setOpen(null)
            navigate(overlay)
          }}
        />
      )}
    </div>
  )
}

function LibidoCalendar({ version, onOpenDay }: { version: number; onOpenDay: (date: string) => void }) {
  const today = todayKey()
  const current = monthKey(today)
  const [month, setMonth] = useState(current)
  const { data: cells } = useLoad(() => api('journal.month', month), [month, version])
  const byDate = new Map((cells ?? []).map((cell: MonthDay) => [cell.date, cell]))
  const inMonth = (cells ?? []).filter((c) => c.date.startsWith(month))
  const rated = inMonth.flatMap((c) => (c.desire === null ? [] : [c.desire]))
  const partnered = inMonth.reduce((s, c) => s + c.partnered, 0)
  const other = inMonth.reduce((s, c) => s + c.other, 0)
  const summary = [
    rated.length ? `Desire avg ${(rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1)}` : 'No desire rated',
    `${partnered} partnered`,
    `${other} other`
  ].join(' · ')

  return (
    <section className="card calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
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
          const cell = byDate.get(date)
          const future = date > today
          return (
            <button
              key={date}
              type="button"
              disabled={future}
              className={`calendar-cell desire-cell ${cell?.desire ? `d${cell.desire}` : ''} ${date === today ? 'today' : ''} ${future ? 'future' : ''}`}
              aria-label={`${longDate(date)}, ${cell?.desire ? `desire ${cell.desire}` : 'desire not rated'}${cell && cell.partnered + cell.other ? `, ${cell.partnered + cell.other} entries` : ''}`}
              onClick={() => onOpenDay(date)}
            >
              <span>{Number(date.slice(8))}</span>
              <span className="cell-dots">
                <span className={cell && cell.partnered > 0 ? 'dot terracotta' : 'dot'} />
                <span className={cell && cell.other > 0 ? 'dot teal' : 'dot'} />
              </span>
            </button>
          )
        })}
      </div>
      <p className="muted small">{summary}</p>
      <div className="legend wrap">
        <span>
          Desire
          <span className="desire-scale" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <i key={n} className={`desire-cell d${n}`}>
                {n}
              </i>
            ))}
          </span>
        </span>
        <span>
          <span className="dot terracotta" /> Partnered
        </span>
        <span>
          <span className="dot teal" /> Other
        </span>
      </div>
    </section>
  )
}

/** A day from the calendar: desire, saved at once, and the day's entries — open one or add a new one. */
function LibidoDaySheet({
  date,
  version,
  onChanged,
  onClose,
  onNavigate
}: {
  date: string
  version: number
  onChanged: () => void
  onClose: () => void
  onNavigate: Navigate
}) {
  const { data: day } = useLoad(() => api('journal.day', date), [date, version])
  const shown = day?.date === date ? day : undefined
  const setDesire = async (desire: number | null) => {
    await api('checkins.setDesire', date, desire)
    onChanged()
  }
  const add = (kind: EventKind) => onNavigate({ type: 'form', kind, date })
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
        <section className="card">
          <div className="card-head">
            <h2>Desire</h2>
            <span className="muted small">1 low · 5 high · tap again to clear</span>
          </div>
          <RatingRow label="Desire" max={DESIRE_MAX} value={shown?.desire ?? null} onChange={(n) => void setDesire(n)} />
        </section>
        <div className="card list-card">
          {shown?.events.map((event) => (
            <EntryRow key={event.id} event={event} onOpen={() => onNavigate({ type: 'detail', id: event.id })} />
          ))}
          {shown && shown.events.length === 0 && <p className="empty-row muted small">No entries on this day</p>}
        </div>
        <div className="day-sheet-add">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" className={`button secondary ${k.partnered ? 'terracotta-text' : 'teal-text'}`} onClick={() => add(k.kind)}>
              + {k.label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

function ActivityCard({ data }: { data: LibidoInsights }) {
  const max = Math.max(1, ...data.buckets.map((b) => b.partnered + b.other))
  const height = 80
  return (
    <section className="card">
      <div className="card-head">
        <h2>Activity per {data.unit}</h2>
      </div>
      <div className="bars" role="img" aria-label={`Partnered and other entries per ${data.unit}`}>
        {data.buckets.map((b) => (
          <div key={b.from} className="bar" title={`${rangeLabel(b, data.unit)}: ${b.partnered} partnered, ${b.other} other`}>
            <span className="bar-part terracotta-bg" style={{ height: (b.partnered / max) * height }} />
            <span className="bar-part teal-bg" style={{ height: (b.other / max) * height }} />
          </div>
        ))}
      </div>
      <AxisLabels buckets={data.buckets} unit={data.unit} />
      <div className="legend">
        <span>
          <i className="swatch terracotta-bg" />
          Partnered · {data.perWeek.partnered} / week
        </span>
        <span>
          <i className="swatch teal-bg" />
          Other · {data.perWeek.other} / week
        </span>
      </div>
    </section>
  )
}

/** Desire per bar on the 1–5 scale; bars with bleeding are shaded when any flow is recorded. */
function DesireCard({ data }: { data: LibidoInsights }) {
  const width = 360
  const height = 96
  const top = 14
  const bottom = height - 6
  const step = width / data.buckets.length
  const x = (i: number) => step * i + step / 2
  const y = (v: number) => bottom - ((v - 1) / (DESIRE_MAX - 1)) * (bottom - top)
  const points = data.buckets.map((b, i) => (b.desire === null ? null : { x: x(i), y: y(b.desire), v: b.desire }))
  // Lines join neighbouring rated bars only; a bar without ratings breaks the line.
  const segments: string[] = []
  let current: string[] = []
  for (const p of points) {
    if (p) current.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    else if (current.length) {
      segments.push(current.join(' '))
      current = []
    }
  }
  if (current.length) segments.push(current.join(' '))
  const rated = points.filter((p) => p !== null)
  // By month nearly every bar holds some bleeding, so shading only says something by week.
  const shade = data.hasFlow && data.unit === 'week'

  return (
    <section className="card">
      <div className="card-head">
        <h2>Desire</h2>
        <span className="muted small">
          {data.unit === 'week' ? 'weekly' : 'monthly'} average{shade ? ' · shaded — bleeding' : ''}
        </span>
      </div>
      {rated.length === 0 ? (
        <p className="muted small">No desire rated in this period.</p>
      ) : (
        <svg className="desire-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average desire per period, 1 to 5">
          {shade &&
            data.buckets.map((b, i) => (b.bleeding ? <rect key={b.from} x={step * i} y={0} width={step} height={height} className="bleeding-band" /> : null))}
          {[1, 3, 5].map((v) => (
            <g key={v}>
              <line x1={0} x2={width} y1={y(v)} y2={y(v)} className={v === 1 ? 'axis' : 'grid'} />
              <text x={width - 2} y={y(v) - 3} textAnchor="end" className="tick">
                {v}
              </text>
            </g>
          ))}
          {segments.map((s) => (
            <polyline key={s} points={s} className="desire-line" />
          ))}
          {rated.map((p) => (
            <circle key={`${p.x}`} cx={p.x} cy={p.y} r={3.5} className="desire-dot">
              <title>{p.v}</title>
            </circle>
          ))}
        </svg>
      )}
    </section>
  )
}

function CompareCard({ current, previous, hasFlow }: { current: InsightsSpan; previous: InsightsSpan; hasFlow: boolean }) {
  const rows: Array<{ name: string; tone: string; now: number | null; before: number | null }> = [
    { name: 'Partnered', tone: 'terracotta-bg', now: current.partnered, before: previous.partnered },
    { name: 'Other activity', tone: 'teal-bg', now: current.other, before: previous.other },
    { name: 'Desire, average', tone: 'teal-bg', now: current.desire, before: previous.desire }
  ]
  if (hasFlow) rows.push({ name: 'Bleeding days', tone: 'berry-bg', now: current.bleedingDays, before: previous.bleedingDays })
  return (
    <section className="card compare">
      <h2>Last 4 weeks vs the 4 before</h2>
      {rows.map((r) => (
        <div key={r.name} className="compare-row">
          <i className={`swatch round ${r.tone}`} />
          <span className="compare-name">{r.name}</span>
          <span className="compare-now">{r.now ?? '—'}</span>
          <span className="compare-before">was {r.before ?? '—'}</span>
          <span className="compare-delta">{delta(r.now, r.before)}</span>
        </div>
      ))}
    </section>
  )
}

function AxisLabels({ buckets, unit }: { buckets: InsightsBucket[]; unit: 'week' | 'month' }) {
  const picks = [buckets[0], buckets[Math.floor((buckets.length - 1) / 2)], buckets.at(-1)].filter((b) => b !== undefined)
  return (
    <div className="axis-labels">
      {picks.map((b) => (
        <span key={b.from}>{unit === 'week' ? shortDate(b.to) : monthName(b.from)}</span>
      ))}
    </div>
  )
}

function delta(now: number | null, before: number | null): string {
  if (now === null || before === null) return ''
  const d = Math.round((now - before) * 10) / 10
  return d === 0 ? '=' : d > 0 ? `+${d}` : `−${Math.abs(d)}`
}

const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const rangeLabel = (b: InsightsBucket, unit: 'week' | 'month') => (unit === 'week' ? `${shortDate(b.from)} – ${shortDate(b.to)}` : monthName(b.from))
