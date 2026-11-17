import { useEffect, useState } from 'react'
import type { LockStatus } from '../../shared/types'
import { PinPad } from '../components/PinPad'
import { ApiError, api } from '../lib/client'

const PIN_LENGTH = 4

/** Screen 1 on the canvas: shown while Tide is locked (T21, T22). */
export function LockScreen({ status, onUnlocked }: { status: LockStatus; onUnlocked: (status: LockStatus) => void }) {
  const [message, setMessage] = useState<string | null>(null)
  const [retryAt, setRetryAt] = useState<number | null>(status.retryAt)
  const [busy, setBusy] = useState(false)
  const now = useNow(retryAt !== null)
  const waiting = retryAt !== null && retryAt > now

  const unlock = async (pin: string) => {
    setBusy(true)
    try {
      onUnlocked(await api('lock.unlockWithPin', pin))
    } catch (error) {
      if (error instanceof ApiError && error.error.code === 'WAIT') setRetryAt((await api('lock.status')).retryAt)
      setMessage(error instanceof Error ? error.message : 'Could not unlock')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lock-screen">
      <div className="lock-icon" aria-hidden="true">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#5FB3BC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 13c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
          <circle cx="18" cy="6" r="1.6" fill="#E8987E" stroke="none" />
        </svg>
      </div>
      <div className="lock-title">
        <h1>Tide is locked</h1>
        <p className={message && !waiting ? 'error-text' : 'muted'} role="status">
          {waiting ? `Too many wrong PINs. Try again in ${countdown(retryAt - now)}.` : (message ?? 'Enter your PIN')}
        </p>
      </div>
      <PinPad length={PIN_LENGTH} disabled={busy || waiting} onComplete={(pin) => void unlock(pin)} />
    </main>
  )
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking])
  return now
}

function countdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
