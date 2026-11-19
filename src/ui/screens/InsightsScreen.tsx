import { DESIRE_MAX } from '../../shared/scales'
import type { InsightsBucket, InsightsDay, InsightsPeriod, InsightsSpan, LibidoInsights } from '../../shared/types'
import { Segmented, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { today as todayKey } from '../lib/dates'
import type { Navigate } from '../navigation'
import { CycleInsightsView } from './CycleInsights'

export type InsightsView = 'libido' | 'cycle'
const VIEWS: ReadonlyArray<{ value: InsightsView; label: string }> = [
  { value: 'libido', label: 'Libido' },
  { value: 'cycle', label: 'Cycle' }
]

const PERIODS: ReadonlyArray<{ value: InsightsPeriod; label: string }> = [
  { value: '12w', label: '12 weeks' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: 'Year' }
]

/** Insights — libido (screen 6, phase 5): activity, desire, activity by day, the last four weeks against the four before. */
export function InsightsScreen({
  version,
  period,
  onPeriod,
  onOpenDay,
  view,
  onView,
  navigate
}: {
  version: number
  period: InsightsPeriod
  onPeriod: (period: InsightsPeriod) => void
  onOpenDay: (date: string) => void
  view: InsightsView
  onView: (view: InsightsView) => void
  navigate: Navigate
}) {
  return (
    <div className="screen insights">
      <header className="screen-header">
        <h1>Insights</h1>
        <Segmented label="Insights" size="small" options={VIEWS} value={view} onChange={(v) => v && onView(v)} />
      </header>
      {view === 'libido' ? (
        <LibidoInsightsView version={version} period={period} onPeriod={onPeriod} onOpenDay={onOpenDay} />
      ) : (
        <CycleInsightsView version={version} navigate={navigate} />
      )}
    </div>
  )
}

function LibidoInsightsView({
  version,
  period,
  onPeriod,
  onOpenDay
}: {
  version: number
  period: InsightsPeriod
  onPeriod: (period: InsightsPeriod) => void
  onOpenDay: (date: string) => void
}) {
  const today = todayKey()
  const { data, error } = useLoad(() => api('insights.libido', today, period), [today, period, version])

  return (
    <>
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
          <HeatMapCard days={data.days} onOpenDay={onOpenDay} />
          <CompareCard current={data.compare.current} previous={data.compare.previous} hasFlow={data.hasFlow} />
        </>
      )}
    </>
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

/** Activity by day: one square a day, weeks as columns, Monday on top. Terracotta when a day had partnered sex. A tap opens the day. */
function HeatMapCard({ days, onOpenDay }: { days: InsightsDay[]; onOpenDay: (date: string) => void }) {
  const first = days[0]
  if (!first) return null
  const offset = (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7
  const cells: Array<InsightsDay | null> = [...Array.from({ length: offset }, () => null), ...days]
  const columns = Math.ceil(cells.length / 7)
  const level = (d: InsightsDay) => (d.entries === 0 ? 0 : Math.min(d.entries, 3))
  return (
    <section className="card">
      <div className="card-head">
        <h2>Activity by day</h2>
        <span className="muted small heat-legend">
          less <i className="heat l1" /> <i className="heat l2" /> <i className="heat l3" /> more
        </span>
      </div>
      <div className="heatmap" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 14px))` }} role="group" aria-label="Entries per day">
        {cells.map((d, i) =>
          d ? (
            <button
              key={d.date}
              type="button"
              className={`heat l${level(d)} ${d.partnered > 0 ? 'partnered' : ''}`}
              aria-label={`${dayLabel(d.date)}: ${d.entries} ${d.entries === 1 ? 'entry' : 'entries'}`}
              onClick={() => onOpenDay(d.date)}
            />
          ) : (
            <i key={`pad-${i}`} className="heat pad" />
          )
        )}
      </div>
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
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const rangeLabel = (b: InsightsBucket, unit: 'week' | 'month') => (unit === 'week' ? `${shortDate(b.from)} – ${shortDate(b.to)}` : monthName(b.from))
