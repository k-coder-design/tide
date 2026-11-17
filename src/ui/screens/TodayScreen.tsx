import { DESIRE_MAX } from '../../shared/scales'
import type { EventKind } from '../../shared/types'
import { KindBadge, RatingRow, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { longDate, today as todayKey, weekdayLetter } from '../lib/dates'
import { KINDS } from '../lib/entries'
import type { Navigate } from '../navigation'

/** Today (screen 2 on the canvas): the day's desire, quick logging, the week at a glance. */
export function TodayScreen({ version, navigate, onChanged }: { version: number; navigate: Navigate; onChanged: () => void }) {
  const today = todayKey()
  const { data, error } = useLoad(() => api('today.summary', today), [today, version])

  const setDesire = async (desire: number | null) => {
    await api('checkins.setDesire', today, desire)
    onChanged()
  }
  const log = (kind: EventKind) => navigate({ type: 'form', kind, date: today })
  const week = data?.week

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="caption">{longDate(today)}</p>
          <h1>Today</h1>
        </div>
      </header>
      {error && <p className="error-text">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h2>Desire</h2>
          <span className="muted small">1 low · 5 high</span>
        </div>
        <RatingRow label="Desire" max={DESIRE_MAX} value={data?.desire ?? null} onChange={(n) => void setDesire(n)} />
      </section>

      <section className="log-grid" aria-label="Log an entry">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className="log-tile" onClick={() => log(k.kind)}>
            <KindBadge icon={k.icon} tone={k.partnered ? 'terracotta' : 'teal'} size={32} />
            <span>+ {k.label}</span>
          </button>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>This week</h2>
          <span className="muted small">{week?.desireAverage != null ? `Desire avg ${week.desireAverage.toFixed(1)}` : 'No desire rated yet'}</span>
        </div>
        <div className="stats">
          <span>
            <b className="terracotta-text">{week?.partnered ?? 0}</b> partnered
          </span>
          <span>
            <b className="teal-text">{week?.other ?? 0}</b> other
          </span>
        </div>
        <div className="week-bars" role="img" aria-label="Desire and activity over the last seven days">
          {(week?.days ?? []).map((day) => (
            <div key={day.date} className={`week-day ${day.date === today ? 'current' : ''}`}>
              <span className="week-value">{day.desire ?? ''}</span>
              <span className="week-bar" style={{ height: day.desire === null ? 3 : day.desire * 12 }} />
              <span className="week-dots">
                <span className={day.partnered > 0 ? 'dot terracotta' : 'dot'} />
                <span className={day.other > 0 ? 'dot teal' : 'dot'} />
              </span>
              <span className="week-letter">{weekdayLetter(day.date)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
