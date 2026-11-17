import { DESIRE_MAX } from '../../shared/scales'
import type { EventKind } from '../../shared/types'
import { Icon } from '../components/Icon'
import { useState } from 'react'
import { KindBadge, RatingRow, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { addDays, dayMonth, longDate, today as todayKey, weekdayLetter, weekdayName } from '../lib/dates'
import { KINDS } from '../lib/entries'
import type { Navigate } from '../navigation'

/**
 * Today (screen 2 on the canvas): the day's desire, quick logging, the week at a glance. The arrows by the
 * date — or a tap on a day in the week — switch desire and quick logging to a past day (T23).
 */
export function TodayScreen({
  version,
  navigate,
  onChanged,
  onLock
}: {
  version: number
  navigate: Navigate
  onChanged: () => void
  /** Shown as the lock button when App lock is on. */
  onLock?: () => void
}) {
  const today = todayKey()
  const [picked, setDay] = useState(today)
  // Never ahead of today, even if the app stayed open past midnight.
  const day = picked > today ? today : picked
  const { data, error } = useLoad(() => api('today.summary', today), [today, version])
  const { data: shown } = useLoad(() => api('journal.day', day), [day, version])

  const setDesire = async (desire: number | null) => {
    await api('checkins.setDesire', day, desire)
    onChanged()
  }
  const log = (kind: EventKind) => navigate({ type: 'form', kind, date: day })
  const week = data?.week
  const isToday = day === today

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="caption">{longDate(day)}</p>
          <h1>{dayTitle(day, today)}</h1>
        </div>
        <div className="day-switch">
          <button type="button" className="round-button" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>
            <Icon name="back" size={18} strokeWidth={2} />
          </button>
          <button type="button" className="round-button" aria-label="Next day" disabled={isToday} onClick={() => setDay(addDays(day, 1))}>
            <Icon name="forward" size={18} strokeWidth={2} />
          </button>
        </div>
        {onLock && (
          <button type="button" className="round-button" aria-label="Lock Tide" onClick={onLock}>
            <Icon name="lock" size={18} />
          </button>
        )}
      </header>
      {error && <p className="error-text">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h2>Desire</h2>
          {isToday ? (
            <span className="muted small">1 low · 5 high</span>
          ) : (
            <button type="button" className="link small" onClick={() => setDay(today)}>
              Back to today
            </button>
          )}
        </div>
        <RatingRow label="Desire" max={DESIRE_MAX} value={shown?.date === day ? shown.desire : null} onChange={(n) => void setDesire(n)} />
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
          {(week?.days ?? []).map((w) => (
            <button
              key={w.date}
              type="button"
              className={`week-day ${w.date === day ? 'current' : ''}`}
              aria-label={`Show ${longDate(w.date)}`}
              aria-pressed={w.date === day}
              onClick={() => setDay(w.date)}
            >
              <span className="week-value">{w.desire ?? ''}</span>
              <span className="week-bar" style={{ height: w.desire === null ? 3 : w.desire * 12 }} />
              <span className="week-dots">
                <span className={w.partnered > 0 ? 'dot terracotta' : 'dot'} />
                <span className={w.other > 0 ? 'dot teal' : 'dot'} />
              </span>
              <span className="week-letter">{weekdayLetter(w.date)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/** "Today", "Yesterday", or the weekday for the rest of the week, then the date. */
function dayTitle(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  if (day >= addDays(today, -6)) return weekdayName(day)
  return dayMonth(day)
}
