import { useState } from 'react'
import type { BleedingEpisode, CycleInsights } from '../../shared/types'
import { Icon } from '../components/Icon'
import { Segmented, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { flowLabel } from '../lib/cycle'
import { today as todayKey } from '../lib/dates'
import type { Navigate } from '../navigation'

const VIEWS = [
  { value: 'month', label: 'By month' },
  { value: 'day', label: 'By day' }
] as const

/** Insights — cycle (screen 6b on the canvas, T13): bleeding episodes and cycles, bleeding and spotting, pills. No predictions. */
export function CycleInsightsView({ version, navigate }: { version: number; navigate: Navigate }) {
  const today = todayKey()
  const { data, error } = useLoad(() => api('insights.cycle', today), [today, version])
  if (error) return <p className="error-text">{error}</p>
  if (!data) return null
  if (!data.hasFlow && data.pills.length === 0) {
    return (
      <section className="card">
        <h2>Nothing to chart yet</h2>
        <p className="muted">Record bleeding on Today, or bring your history over once: Settings → Import from Apple Health. Episodes, cycles and pills appear here.</p>
      </section>
    )
  }
  return (
    <>
      {data.hasFlow && <EpisodesCard data={data} />}
      {data.hasFlow && <FlowCard data={data} />}
      <DesireNote data={data} />
      {data.pills.length > 0 && (
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
    </>
  )
}

function EpisodesCard({ data }: { data: CycleInsights }) {
  const [all, setAll] = useState(false)
  const shown = all ? data.episodes : data.episodes.slice(0, 3)
  const since = data.episodes.at(-1)?.start
  return (
    <section className="card episodes">
      <div className="card-head">
        <h2>Bleeding episodes</h2>
        <span className="muted small">{all && since ? `all ${data.episodes.length} since ${monthYear(since)}` : `last ${Math.min(3, data.episodes.length)}`}</span>
      </div>
      {data.episodes.length === 0 ? (
        <p className="muted small">Only spotting so far — spotting never starts an episode.</p>
      ) : (
        <>
          <div className="episode-head">
            <span>Start – end</span>
            <span>Days</span>
            <span>Cycle</span>
          </div>
          <div className={`episode-list ${all ? 'scroll' : ''}`}>
            {shown.map((e) => (
              <div key={e.start} className="episode-row">
                <i className={`flow-swatch ${e.strongest}`} />
                <span className="episode-dates">
                  <b>{episodeDates(e)}</b>
                  <span className="muted">
                    {flowLabel(e.strongest).toLowerCase()}
                    {e.spottingDays ? ` · +${e.spottingDays} spotting` : ''}
                    {e.fromHealth ? ' · Health' : ''}
                  </span>
                </span>
                <b className="num">{e.ongoing ? `${e.days}+` : e.days}</b>
                <b className={`num ${e.cycle === null ? 'muted' : ''}`}>{e.cycle ?? '—'}</b>
              </div>
            ))}
          </div>
          <div className="episode-foot muted small">
            {data.averageEpisode !== null && (
              <span>
                Episode <b>{days(data.averageEpisode)}</b> avg
              </span>
            )}
            {data.averageCycle !== null && data.cycleRange && (
              <span>
                Cycle <b>{days(data.averageCycle)}</b> avg{data.cycleRange.min !== data.cycleRange.max ? ` (${data.cycleRange.min}–${data.cycleRange.max})` : ''}
              </span>
            )}
          </div>
          {data.episodes.length > 3 && (
            <button type="button" className="button secondary" onClick={() => setAll(!all)}>
              {all ? 'Show last 3' : `Show all (${data.episodes.length})`}
            </button>
          )}
        </>
      )}
      <p className="muted tiny">An episode starts on its first bleeding day; spotting never starts one. Cycle — days to the next episode's start.</p>
    </section>
  )
}

function FlowCard({ data }: { data: CycleInsights }) {
  const [view, setView] = useState<'month' | 'day'>('month')
  const max = Math.max(1, ...data.months.map((m) => m.bleedingDays + m.spottingDays))
  const height = 84
  return (
    <section className="card">
      <div className="card-head">
        <h2>Bleeding and spotting</h2>
        <div className="mini-switch">
          <Segmented label="Show" size="small" options={VIEWS} value={view} onChange={(v) => v && setView(v)} />
        </div>
      </div>
      {view === 'month' ? (
        <>
          <div className="flow-months" role="img" aria-label="Bleeding and spotting days per month">
            {data.months.map((m) => (
              <div key={m.month} className="flow-month">
                <span className="small strong">
                  {m.bleedingDays}
                  {m.spottingDays ? <span className="berry-soft"> +{m.spottingDays}</span> : null}
                </span>
                <span className="flow-stack">
                  <span className="bar-part spotting-bg" style={{ height: (m.spottingDays / max) * height }} />
                  <span className="bar-part berry-bg" style={{ height: (m.bleedingDays / max) * height }} />
                </span>
                <span className="muted small">{monthShort(m.month)}</span>
              </div>
            ))}
          </div>
          <div className="legend">
            <span>
              <i className="swatch berry-bg" /> Bleeding days
            </span>
            <span>
              <i className="swatch spotting-bg" /> Spotting days (+)
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flow-days" role="img" aria-label="Flow by day over the last 12 weeks, Monday on top">
            {data.days.map((d) => (
              <i key={d.date} className={`flow-day ${d.flow ?? 'unrecorded'}`} title={`${d.date}: ${d.flow ? flowLabel(d.flow) : 'not recorded'}`} />
            ))}
          </div>
          <div className="legend wrap">
            <span>
              <i className="swatch flow-day unrecorded" /> Not recorded
            </span>
            <span>
              <i className="swatch flow-day none" /> None
            </span>
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
          </div>
        </>
      )}
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

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
const fmt = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' })
const monthShort = (month: string) => fmt(`${month}-01`, { month: 'short' })
const monthYear = (date: string) => fmt(date, { month: 'short', year: 'numeric' })

function episodeDates(e: BleedingEpisode): string {
  const start = fmt(e.start, { day: 'numeric', month: 'short' })
  if (e.ongoing) return `${start} – now`
  if (e.start === e.last) return start
  const sameMonth = e.start.slice(0, 7) === e.last.slice(0, 7)
  return `${sameMonth ? fmt(e.start, { day: 'numeric' }) : start} – ${fmt(e.last, { day: 'numeric', month: 'short' })}`
}
