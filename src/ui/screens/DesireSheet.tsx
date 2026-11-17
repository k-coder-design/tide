import { useState } from 'react'
import { DESIRE_MAX } from '../../shared/scales'
import { RatingRow, Sheet, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { longDate } from '../lib/dates'

/** Desire for any past day — opened from a check-in or an unrated day in the journal (T23). */
export function DesireSheet({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const { data } = useLoad(() => api('journal.day', date), [date])
  const [value, setValue] = useState<number | null | undefined>(undefined)
  const current = value === undefined ? (data?.desire ?? null) : value

  const save = async () => {
    await api('checkins.setDesire', date, current)
    onSaved()
  }

  return (
    <Sheet label="Desire" onClose={onClose}>
      <header className="sheet-header">
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
        <h1>Desire</h1>
        <button type="button" className="link strong" onClick={() => void save()}>
          Save
        </button>
      </header>
      <div className="sheet-body">
        <p className="muted">{longDate(date)}</p>
        <RatingRow label="Desire" max={DESIRE_MAX} value={current} onChange={setValue} />
        <p className="muted small">1 low · 5 high. Tap the chosen number again to clear the day.</p>
      </div>
    </Sheet>
  )
}
