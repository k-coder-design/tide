import { useState } from 'react'
import type { LockProof, LockStatus } from '../../shared/types'
import { Icon } from '../components/Icon'
import { PinPad } from '../components/PinPad'
import { Sheet } from '../components/controls'
import { api } from '../lib/client'
import { FaceIdError, createFaceIdKey, faceIdSecret } from '../lib/faceId'

const PIN_LENGTH = 4
const AUTO_LOCK: ReadonlyArray<{ value: LockStatus['autoLock']; label: string }> = [
  { value: 0, label: 'Immediately' },
  { value: 1, label: 'After 1 minute' },
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' }
]

type Open = 'enable' | 'disable' | 'change' | 'autolock' | null

/** Settings → Privacy (T7, T21): App lock, Face ID, Auto-lock, Change PIN — as on the Settings mockup. */
export function PrivacySettings({ status, onStatus }: { status: LockStatus; onStatus: (status: LockStatus) => void }) {
  const [open, setOpen] = useState<Open>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const close = () => setOpen(null)
  const done = (next: LockStatus) => {
    onStatus(next)
    setOpen(null)
  }

  const toggleFaceId = async () => {
    setError(null)
    setBusy(true)
    try {
      if (status.faceId) {
        onStatus(await api('lock.disableFaceId'))
      } else {
        const { credentialId, prfSalt, secret } = await createFaceIdKey()
        onStatus(await api('lock.enableFaceId', credentialId, prfSalt, secret))
      }
    } catch (reason) {
      if (!(reason instanceof FaceIdError && reason.cancelled)) setError(reason instanceof Error ? reason.message : 'Could not change Face ID')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="group">
      <h2 className="label">Privacy</h2>
      <div className="card list-card">
        <div className="row">
          <span className="row-text">
            <span className="row-title">App lock</span>
            <span className="row-sub">{status.enabled ? 'PIN when Tide opens' : 'Off — Tide opens without a PIN'}</span>
          </span>
          <Switch label="App lock" on={status.enabled} onChange={() => setOpen(status.enabled ? 'disable' : 'enable')} />
        </div>
        {status.enabled && (
          <>
            <div className="row">
              <span className="row-text">
                <span className="row-title">Face ID</span>
                <span className="row-sub">Instead of typing the PIN</span>
              </span>
              <Switch label="Face ID" on={status.faceId !== null} disabled={busy} onChange={() => void toggleFaceId()} />
            </div>
            <button type="button" className="row" onClick={() => setOpen('autolock')}>
              <span className="row-text">
                <span className="row-title">Auto-lock</span>
              </span>
              <span className="row-meta">{AUTO_LOCK.find((o) => o.value === status.autoLock)?.label}</span>
              <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
            </button>
            <button type="button" className="row" onClick={() => setOpen('change')}>
              <span className="row-text">
                <span className="row-title">Change PIN</span>
              </span>
              <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
            </button>
          </>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}

      {open === 'enable' && <EnableSheet onClose={close} onDone={done} />}
      {open === 'disable' && <DisableSheet status={status} onClose={close} onDone={done} />}
      {open === 'change' && <ChangePinSheet onClose={close} onDone={done} />}
      {open === 'autolock' && (
        <Sheet label="Auto-lock" onClose={close}>
          <SheetHeader title="Auto-lock" onClose={close} />
          <div className="sheet-body">
            <div className="card list-card">
              {AUTO_LOCK.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="row"
                  aria-pressed={status.autoLock === option.value}
                  onClick={() => void api('lock.setAutoLock', option.value).then(done)}
                >
                  <span className="row-text">
                    <span className="row-title">{option.label}</span>
                  </span>
                  {status.autoLock === option.value && <span className="row-check">✓</span>}
                </button>
              ))}
            </div>
            <p className="muted small">How long Tide may stay in the background before it asks for the PIN again. Closing Tide always locks it.</p>
          </div>
        </Sheet>
      )}
    </section>
  )
}

function Switch({ label, on, onChange, disabled = false }: { label: string; on: boolean; onChange: () => void; disabled?: boolean }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} />
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="sheet-header">
      <button type="button" className="link" onClick={onClose}>
        Cancel
      </button>
      <h1>{title}</h1>
      <span className="sheet-header-spacer" />
    </header>
  )
}

/** A PIN step inside a sheet: a prompt, the keypad and an error line. */
function PinStep({ prompt, note, error, busy, onPin, onFaceId }: { prompt: string; note?: string; error: string | null; busy: boolean; onPin: (pin: string) => void; onFaceId?: () => void }) {
  return (
    <div className="sheet-body pin-step">
      <p className="pin-prompt">{prompt}</p>
      <p className={error ? 'error-text' : 'muted small'} role="status">
        {error ?? note ?? ' '}
      </p>
      <PinPad length={PIN_LENGTH} disabled={busy} onComplete={onPin} onFaceId={onFaceId} />
    </div>
  )
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong'
}

/** Turning the lock on: the PIN twice, with a plain warning that it cannot be recovered. */
function EnableSheet({ onClose, onDone }: { onClose: () => void; onDone: (status: LockStatus) => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const onPin = async (pin: string) => {
    if (first === null) {
      setFirst(pin)
      setError(null)
      return
    }
    if (pin !== first) {
      setFirst(null)
      setError('The PINs did not match. Choose a PIN again.')
      return
    }
    setBusy(true)
    try {
      onDone(await api('lock.enable', pin))
    } catch (reason) {
      setError(message(reason))
      setFirst(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet label="Turn on App lock" onClose={onClose}>
      <SheetHeader title="App lock" onClose={onClose} />
      <PinStep
        prompt={first === null ? 'Choose a 4-digit PIN' : 'Repeat the PIN'}
        note="Tide cannot reset a forgotten PIN: without it, the journal cannot be opened."
        error={error}
        busy={busy}
        onPin={(pin) => void onPin(pin)}
      />
    </Sheet>
  )
}

/** Turning the lock off asks for the PIN or Face ID first (T7). */
function DisableSheet({ status, onClose, onDone }: { status: LockStatus; onClose: () => void; onDone: (status: LockStatus) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const prove = async (proof: () => Promise<LockProof>) => {
    setBusy(true)
    try {
      onDone(await api('lock.disable', await proof()))
    } catch (reason) {
      if (!(reason instanceof FaceIdError && reason.cancelled)) setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  const faceId = status.faceId
  return (
    <Sheet label="Turn off App lock" onClose={onClose}>
      <SheetHeader title="Turn off App lock" onClose={onClose} />
      <PinStep
        prompt="Enter your PIN"
        note="Tide will open without a PIN. The journal stays encrypted on the phone."
        error={error}
        busy={busy}
        onPin={(pin) => void prove(async () => ({ pin }))}
        onFaceId={faceId ? () => void prove(async () => ({ secret: await faceIdSecret(faceId.credentialId, faceId.prfSalt) })) : undefined}
      />
    </Sheet>
  )
}

function ChangePinSheet({ onClose, onDone }: { onClose: () => void; onDone: (status: LockStatus) => void }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const onPin = async (pin: string) => {
    setError(null)
    if (current === null) return setCurrent(pin)
    if (next === null) return setNext(pin)
    if (pin !== next) {
      setNext(null)
      setError('The new PINs did not match. Choose the new PIN again.')
      return
    }
    setBusy(true)
    try {
      onDone(await api('lock.changePin', current, pin))
    } catch (reason) {
      setCurrent(null)
      setNext(null)
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  const prompt = current === null ? 'Enter your current PIN' : next === null ? 'Choose a new 4-digit PIN' : 'Repeat the new PIN'
  return (
    <Sheet label="Change PIN" onClose={onClose}>
      <SheetHeader title="Change PIN" onClose={onClose} />
      <PinStep prompt={prompt} error={error} busy={busy} onPin={(pin) => void onPin(pin)} />
    </Sheet>
  )
}
