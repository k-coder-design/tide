import { useEffect, useState } from 'react'
import type { JournalDay, JournalFilter, JournalPage, MonthDay } from '../../shared/types'
import { Icon } from '../components/Icon'
import { CheckinRow, EntryRow, Segmented, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { dayHeading, monthCells, monthKey, monthTitle, shiftMonth, today as todayKey } from '../lib/dates'
import type { Navigate } from '../navigation'

const PAGE_DAYS = 20
const VIEWS = [
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' }
] as const
const FILTERS: ReadonlyArray<{ value: JournalFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'partnered', label: 'Partnered' },
  { value: 'other', label: 'Other' },
  { value: 'checkins', label: 'Check-ins' }
]

/** Journal (screen 4): a list by day with filters, or a month calendar. */
export function JournalScreen({ version, navigate }: { version: number; navigate: Navigate }) {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  return (
    <div className="screen journal">
      <header className="screen-header">
        <h1>Journal</h1>
        <Segmented label="Journal view" size="small" options={VIEWS} value={view} onChange={(v) => v && setView(v)} />
      </header>
      {view === 'list' ? <JournalList version={version} navigate={navigate} /> : <JournalCalendar version={version} navigate={navigate} />}
    </div>
  )
}

function DayCard({ day, filter, navigate }: { day: JournalDay; filter: JournalFilter; navigate: Navigate }) {
  const showCheckin = day.desire !== null && (filter === 'all' || filter === 'checkins')
  return (
    <div className="card list-card">
      {day.events.map((event) => (
        <EntryRow key={event.id} event={event} onOpen={() => navigate({ type: 'detail', id: event.id })} />
      ))}
      {showCheckin && <CheckinRow desire={day.desire!} onOpen={() => navigate({ type: 'desire', date: day.date })} />}
    </div>
  )
}

function JournalList({ version, navigate }: { version: number; navigate: Navigate }) {
  const [filter, setFilter] = useState<JournalFilter>('all')
  const [pageCount, setPageCount] = useState(1)
  const [days, setDays] = useState<JournalDay[]>()
  const [more, setMore] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    // Reload as many pages as were shown, so a change does not throw the list back to the top.
    ;(async () => {
      const loaded: JournalDay[] = []
      let before: string | null = null
      for (let i = 0; i < pageCount; i++) {
        const page: JournalPage = await api('journal.days', { before, limit: PAGE_DAYS, filter })
        loaded.push(...page.days)
        before = page.nextBefore
        if (!before) break
      }
      if (active) {
        setDays(loaded)
        setMore(before)
        setError(null)
      }
    })().catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : 'Could not load'))
    return () => {
      active = false
    }
  }, [filter, pageCount, version])

  return (
    <>
      <div className="chips filters" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={filter === f.value}
            className={`chip ink ${filter === f.value ? 'on' : ''}`}
            onClick={() => {
              setFilter(f.value)
              setPageCount(1)
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="day-list">
        {days?.length === 0 && (
          <p className="empty">{filter === 'all' ? 'Nothing logged yet. Entries from Today appear here.' : 'Nothing matches this filter yet.'}</p>
        )}
        {days?.map((day) => (
          <section key={day.date} className="day">
            <div className="day-head">
              <h2 className="label">{dayHeading(day.date)}</h2>
              {day.desire !== null && (filter === 'partnered' || filter === 'other') && <span className="muted small">desire {day.desire}</span>}
            </div>
            <DayCard day={day} filter={filter} navigate={navigate} />
          </section>
        ))}
        {more && (
          <button type="button" className="button secondary" onClick={() => setPageCount((n) => n + 1)}>
            Show older
          </button>
        )}
      </div>
    </>
  )
}

function JournalCalendar({ version, navigate }: { version: number; navigate: Navigate }) {
  const today = todayKey()
  const [month, setMonth] = useState(monthKey(today))
  const [selected, setSelected] = useState(today)
  const { data: cells } = useLoad(() => api('journal.month', month), [month, version])
  const { data: day } = useLoad(() => api('journal.day', selected), [selected, version])
  const byDate = new Map((cells ?? []).map((cell: MonthDay) => [cell.date, cell]))
  const isEmpty = day && day.desire === null && day.events.length === 0

  return (
    <>
      <section className="card calendar">
        <div className="calendar-head">
          <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="back" strokeWidth={2} />
          </button>
          <h2>{monthTitle(month)}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Next month"
            disabled={month >= monthKey(today)}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
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
                className={`calendar-cell ${date === selected ? 'selected' : ''} ${date === today ? 'today' : ''} ${future ? 'future' : ''}`}
                aria-label={date}
                aria-pressed={date === selected}
                onClick={() => setSelected(date)}
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
        <div className="legend">
          <span>
            <span className="dot terracotta" /> Partnered
          </span>
          <span>
            <span className="dot teal" /> Other
          </span>
        </div>
      </section>
      <section className="day">
        <div className="day-head">
          <h2 className="label">{dayHeading(selected)}</h2>
          <button type="button" className="link small" onClick={() => navigate({ type: 'form', kind: 'sex', date: selected })}>
            + Add entry
          </button>
        </div>
        {day && !isEmpty && <DayCard day={day} filter="all" navigate={navigate} />}
        {isEmpty && (
          <div className="card list-card">
            <p className="empty-row">Nothing recorded on this day</p>
          </div>
        )}
      </section>
    </>
  )
}
