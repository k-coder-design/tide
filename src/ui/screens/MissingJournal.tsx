import { useState } from 'react'
import type { LockStatus } from '../../shared/types'
import { api } from '../lib/client'

/**
 * The saves disappeared while the key stayed (T24). Tide does not start an empty journal on its own: it explains,
 * and starts over only after two taps. Starting over cannot erase anything — the core refuses while a save exists.
 */
export function MissingJournal({ message, onStarted }: { message: string; onStarted: (status: LockStatus) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startOver = async () => {
    setBusy(true)
    setError(null)
    try {
      onStarted(await api('storage.startOver'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <main className="fatal">
      <h1>Your journal is missing</h1>
      <p>{message}</p>
      <p>
        First close Tide fully and open it again. If the journal is still missing, start a new one and then bring your entries back from your
        latest backup: Settings → Restore from backup.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="push-bottom fatal-actions">
        {confirming ? (
          <>
            <p className="small">A new, empty journal starts. App lock will be off until you turn it on again.</p>
            <button type="button" className="button danger" disabled={busy} onClick={() => void startOver()}>
              Start an empty journal
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="button secondary" onClick={() => setConfirming(true)}>
            Start a new journal…
          </button>
        )}
      </div>
    </main>
  )
}
