import { useRef, useState } from 'react'
import type { BackupStatus, HealthImportResult, LockStatus, MergeResult, RestoreMode } from '../../shared/types'
import { Icon } from '../components/Icon'
import { ConfirmSheet, Segmented, Sheet, SheetHeader, Switch, useLoad } from '../components/controls'
import { api } from '../lib/client'

const PASSWORD_MIN = 8

/** Settings → Backup (phase 4, T14, T26): back up now, backup password, weekly reminder, restore. */
export function BackupSettings({ onRestored }: { onRestored: () => void }) {
  const [version, setVersion] = useState(0)
  const { data: status } = useLoad(() => api('backup.status'), [version])
  const [open, setOpen] = useState<'backup' | 'password' | 'plain' | 'restore' | 'health' | null>(null)
  const refresh = () => setVersion((v) => v + 1)
  const close = () => {
    setOpen(null)
    refresh()
  }

  return (
    <section className="group">
      <h2 className="label">Backup</h2>
      <div className="card list-card">
        <button type="button" className="row" onClick={() => setOpen('backup')}>
          <span className="row-text">
            <span className="row-title accent strong">Back up now</span>
            <span className="row-sub">{status ? lastBackupText(status) : ' '}</span>
          </span>
        </button>
        <div className="row">
          <span className="row-text">
            <span className="row-title">Password protection</span>
            <span className="row-sub">{status?.plain
                ? 'Off — anyone with a backup file can read it'
                : status?.passwordSet
                  ? 'Backups are encrypted with your password'
                  : 'On — you choose the password at the first backup'}</span>
          </span>
          <Switch
            label="Password protection"
            on={!(status?.plain ?? false)}
            disabled={!status}
            onChange={() => {
              if (!status) return
              if (!status.plain) setOpen('plain')
              else if (status.passwordSet) void api('backup.setPlain', false).then(refresh)
              else setOpen('password')
            }}
          />
        </div>
        {status?.passwordSet && !status.plain && (
          <button type="button" className="row" onClick={() => setOpen('password')}>
            <span className="row-text">
              <span className="row-title">Change backup password</span>
            </span>
            <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
          </button>
        )}
        <div className="row">
          <span className="row-text">
            <span className="row-title">Weekly reminder</span>
            <span className="row-sub">On Today, when the last backup is a week old</span>
          </span>
          <Switch
            label="Weekly reminder"
            on={status?.reminder ?? true}
            disabled={!status}
            onChange={() => status && void api('backup.setReminder', !status.reminder).then(refresh)}
          />
        </div>
        <button type="button" className="row" onClick={() => setOpen('restore')}>
          <span className="row-text">
            <span className="row-title">Restore from backup…</span>
          </span>
          <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
        </button>
        <button type="button" className="row" onClick={() => setOpen('health')}>
          <span className="row-text">
            <span className="row-title">Import from Apple Health…</span>
            <span className="row-sub">Bleeding history and contraceptive courses, once</span>
          </span>
          <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
        </button>
      </div>

      {open === 'backup' && <BackupSheet onClose={close} />}
      {open === 'password' && <PasswordSheet title="Backup password" onClose={close} onDone={close} />}
      {open === 'plain' && <PlainConfirm onCancel={close} onConfirm={() => void api('backup.setPlain', true).then(close)} />}
      {open === 'health' && <HealthImportSheet onClose={close} onImported={onRestored} />}
      {open === 'restore' && (
        <RestoreSheet
          onClose={close}
          onRestored={() => {
            refresh()
            onRestored()
          }}
        />
      )}
    </section>
  )
}

/**
 * Makes a backup and hands it to the Share sheet (Save to Files → On My iPhone, AirDrop to the Mac, iCloud Drive).
 * The file is prepared first and shared from a second tap, because iOS opens the Share sheet only right after a tap.
 */
export function BackupSheet({ onClose }: { onClose: () => void }) {
  const { data: status } = useLoad(() => api('backup.status'), [])
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [passwordSet, setPasswordSet] = useState(false)
  const [askPlain, setAskPlain] = useState(false)
  const [plainChosen, setPlainChosen] = useState(false)

  const prepare = async () => {
    setBusy(true)
    setError(null)
    try {
      const bytes = await api('backup.create')
      setFile(new File([bytes as Uint8Array<ArrayBuffer>], `tide-backup-${localDate()}.tide`, { type: 'application/octet-stream' }))
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    if (!file) return
    setError(null)
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
      } else {
        download(file)
      }
      await api('backup.markDone')
      setSaved(true)
    } catch (reason) {
      // Closing the Share sheet without choosing anything is not an error, and not a backup either.
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(message(reason))
    }
  }

  if (status && !status.passwordSet && !status.plain && !passwordSet) {
    return (
      <>
        <PasswordSheet
          title="Backup password"
          first
          onClose={onClose}
          onDone={() => {
            setPasswordSet(true)
            void prepare()
          }}
          onWithout={() => setAskPlain(true)}
        />
        {askPlain && (
          <PlainConfirm
            onCancel={() => setAskPlain(false)}
            onConfirm={() =>
              void api('backup.setPlain', true).then(() => {
                setAskPlain(false)
                setPlainChosen(true)
                setPasswordSet(true)
                void prepare()
              })
            }
          />
        )}
      </>
    )
  }
  const plain = Boolean(status?.plain) || plainChosen

  return (
    <Sheet label="Back up" onClose={onClose}>
      <SheetHeader title="Back up" onClose={onClose} />
      <div className="sheet-body">
        {saved ? (
          <>
            <p className="pin-prompt">Backup saved</p>
            <p className="muted">
              Keep a copy off this phone now and then — on your Mac or in iCloud Drive. A backup kept only on this iPhone is lost with it.
            </p>
            <button type="button" className="button primary push-bottom" onClick={onClose}>
              Done
            </button>
          </>
        ) : file ? (
          <>
            <div className="card file-card">
              <Icon name="journal" size={22} color="var(--teal)" />
              <span className="row-text">
                <span className="row-title">{file.name}</span>
                <span className={`row-sub ${plain ? 'danger-text' : ''}`}>
                  {sizeText(file.size)} · {plain ? 'not encrypted — keep it private' : 'encrypted with your backup password'}
                </span>
              </span>
            </div>
            <p className="muted small">In the Share sheet choose Save to Files → On My iPhone, or send it to your Mac.</p>
            {error && <p className="error-text">{error}</p>}
            <button type="button" className="button primary push-bottom" onClick={() => void share()}>
              Save or share…
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              {plain
                ? 'The whole journal goes into one file without a password: anyone who gets the file can read it. Password protection can be turned back on in Settings.'
                : 'The whole journal goes into one file, encrypted with your backup password. You need the password to restore it.'}
            </p>
            {error && <p className="error-text">{error}</p>}
            <button type="button" className="button primary push-bottom" disabled={busy || !status} onClick={() => void prepare()}>
              {busy ? 'Preparing…' : 'Make the backup'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** Sets or changes the backup password: twice, with the warning that a lost one cannot be recovered. */
function PasswordSheet({
  title,
  first = false,
  onClose,
  onDone,
  onWithout
}: {
  title: string
  first?: boolean
  onClose: () => void
  onDone: (status: BackupStatus) => void
  /** Offered on the first backup: back up without a password instead (T28). */
  onWithout?: () => void
}) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (password.length < PASSWORD_MIN) return setError(`At least ${PASSWORD_MIN} characters`)
    if (password !== repeat) return setError('The passwords do not match')
    setBusy(true)
    try {
      onDone(await api('backup.setPassword', password))
    } catch (reason) {
      setError(message(reason))
      setBusy(false)
    }
  }

  return (
    <Sheet label={title} onClose={onClose}>
      <SheetHeader title={title} onClose={onClose} />
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="muted">
          {first ? 'Backups are encrypted with a password of their own. ' : 'New backups will use the new password; older backup files keep the old one. '}
          Write it down somewhere safe: without it a backup cannot be opened, and it cannot be reset.
        </p>
        <input
          className="text-input"
          type="password"
          autoComplete="new-password"
          aria-label="Backup password"
          placeholder={`Password, ${PASSWORD_MIN}+ characters`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className="text-input"
          type="password"
          autoComplete="new-password"
          aria-label="Repeat the password"
          placeholder="Repeat the password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="push-bottom stack">
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Saving…' : first ? 'Set password and continue' : 'Save password'}
          </button>
          {onWithout && (
            <button type="button" className="button secondary" disabled={busy} onClick={onWithout}>
              Back up without a password
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

const MODES: ReadonlyArray<{ value: RestoreMode; label: string }> = [
  { value: 'replace', label: 'Replace' },
  { value: 'merge', label: 'Merge' }
]

/** Restores a backup file: Replace (the usual choice on a new phone) or Merge. */
function RestoreSheet({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<RestoreMode>('replace')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)

  const restore = async () => {
    if (!file) return
    setConfirming(false)
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setResult(await api('backup.restore', bytes, password, mode))
      onRestored()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet label="Restore from backup" onClose={onClose}>
      <SheetHeader title="Restore" onClose={onClose} />
      <div className="sheet-body">
        {result ? (
          <>
            <p className="pin-prompt">{mode === 'replace' ? 'Journal restored' : 'Backup merged'}</p>
            <p className="muted">
              The backup holds {plural(result.entries, 'entry', 'entries')} and {plural(result.days, 'rated day', 'rated days')}.
              {mode === 'merge' && ` ${plural(result.added, 'item was', 'items were')} added and ${plural(result.updated, 'item', 'items')} updated with a newer copy.`}
            </p>
            <button type="button" className="button primary push-bottom" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
            <button type="button" className="card file-card file-pick" onClick={() => input.current?.click()}>
              <Icon name="journal" size={22} color="var(--teal)" />
              <span className="row-text">
                <span className="row-title">{file ? file.name : 'Choose a backup file'}</span>
                <span className="row-sub">{file ? sizeText(file.size) : 'From Files — On My iPhone, iCloud Drive…'}</span>
              </span>
            </button>
            <input
              className="text-input"
              type="password"
              autoComplete="current-password"
              aria-label="Backup password"
              placeholder="Backup password, if it has one"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Segmented label="Restore mode" options={MODES} value={mode} onChange={(m) => m && setMode(m)} />
            <p className="muted small">
              {mode === 'replace'
                ? 'The backup becomes the whole journal; what is here now is replaced. The usual choice on a new phone.'
                : 'Adds entries missing here and takes newer copies from the backup; nothing here is deleted. Entries deleted since the backup may come back.'}{' '}
              App lock stays as it is.
            </p>
            {error && <p className="error-text">{error}</p>}
            <button
              type="button"
              className="button primary push-bottom"
              disabled={!file || busy}
              onClick={() => (mode === 'replace' ? setConfirming(true) : void restore())}
            >
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </>
        )}
      </div>
      {confirming && (
        <ConfirmSheet
          title="Replace this journal?"
          message="Everything in Tide now is replaced by the backup. This cannot be undone."
          confirm="Replace"
          onConfirm={() => void restore()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Sheet>
  )
}

/**
 * The one-time Apple Health import (T12, T27). The export is too large for the phone's browser, so a script on the Mac
 * turns it into a small encrypted file; this sheet explains the steps and imports that file.
 */
function HealthImportSheet({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HealthImportResult | null>(null)

  const run = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api('health.import', new Uint8Array(await file.arrayBuffer()), password))
      onImported()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet label="Import from Apple Health" onClose={onClose}>
      <SheetHeader title="Apple Health" onClose={onClose} />
      <div className="sheet-body">
        {result ? (
          <>
            <p className="pin-prompt">Imported</p>
            <p className="muted">
              {plural(result.bleedingDays, 'bleeding day', 'bleeding days')}, {plural(result.spottingDays, 'spotting day', 'spotting days')} and{' '}
              {plural(result.courses, 'contraceptive course', 'contraceptive courses')} were added.
              {result.keptDays + result.keptCourses > 0 &&
                ` ${plural(result.keptDays + result.keptCourses, 'item was', 'items were')} already in Tide and kept as it was.`}{' '}
              See them in Insights → Cycle; give the imported course its real name in Settings → Medications.
            </p>
            <p className="muted small">You can now delete export.zip and the import file from the Mac and from Files.</p>
            <button type="button" className="button primary push-bottom" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <ol className="steps">
              <li>In Health on this iPhone: your picture → Export All Health Data. AirDrop export.zip to your Mac.</li>
              <li>
                On the Mac, in the Tide folder: <code>npm run health-import -- ~/Downloads/export.zip</code> and choose a password.
              </li>
              <li>AirDrop the .tidehealth file back to this iPhone → Save to Files, then choose it below — not export.zip itself.</li>
            </ol>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
            <button type="button" className="card file-card file-pick" onClick={() => input.current?.click()}>
              <Icon name="journal" size={22} color="var(--teal)" />
              <span className="row-text">
                <span className="row-title">{file ? file.name : 'Choose the import file'}</span>
                <span className="row-sub">{file ? sizeText(file.size) : 'tide-health-….tidehealth'}</span>
              </span>
            </button>
            <input
              className="text-input"
              type="password"
              autoComplete="off"
              aria-label="Import file password"
              placeholder="Password chosen on the Mac"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="muted small">Only bleeding, spotting and contraceptive courses are read. Days already recorded in Tide are never changed.</p>
            {error && <p className="error-text">{error}</p>}
            <button type="button" className="button primary push-bottom" disabled={!file || !password || busy} onClick={() => void run()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** The warning before backups without a password (T28). */
function PlainConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmSheet
      title="Back up without a password?"
      message="Backup files will not be encrypted. Anyone who gets one — from Files, iCloud Drive or your Mac — can read your whole journal. Tide on this iPhone stays encrypted."
      confirm="Back up without a password"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/** Settings → Delete all data… (phase 4): two steps, then Tide starts again as on first launch. */
export function DeleteAllRow({ onDeleted }: { onDeleted: (status: LockStatus) => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    try {
      onDeleted(await api('storage.deleteAll'))
    } catch (reason) {
      setError(message(reason))
      setStep(0)
    }
  }
  return (
    <>
      <button type="button" className="row" onClick={() => setStep(1)}>
        <span className="row-text">
          <span className="row-title danger-text">Delete all data…</span>
          {error && <span className="row-sub error-text">{error}</span>}
        </span>
      </button>
      {step === 1 && (
        <ConfirmSheet
          title="Delete all data?"
          message="Every entry, rating, partner label, setting and the PIN are erased from this iPhone. Backup files you saved stay where they are."
          confirm="Continue"
          onConfirm={() => setStep(2)}
          onCancel={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <ConfirmSheet
          title="This cannot be undone"
          message="Without a backup, the journal is gone for good."
          confirm="Delete everything"
          onConfirm={() => void remove()}
          onCancel={() => setStep(0)}
        />
      )}
    </>
  )
}

export function lastBackupText(status: BackupStatus): string {
  if (!status.lastBackupAt) return 'No backup yet'
  const days = Math.floor((Date.now() - Date.parse(status.lastBackupAt)) / 86_400_000)
  return `Last backup ${days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function localDate(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Where the Share sheet is missing (desktop browsers): a plain download. */
function download(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong'
}
