import { useState } from 'react'
import type { LockStatus, Partner, Settings, Theme } from '../../shared/types'
import { Icon } from '../components/Icon'
import { Segmented, Sheet, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { PrivacySettings } from './PrivacySettings'

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

/** Settings (screen 9) — the parts that work in this version: privacy, partner labels and appearance. */
export function SettingsScreen({
  settings,
  onSettings,
  lock,
  onLockStatus
}: {
  settings: Settings
  onSettings: (settings: Settings) => void
  lock: LockStatus
  onLockStatus: (status: LockStatus) => void
}) {
  const [version, setVersion] = useState(0)
  const { data: partners } = useLoad(() => api('partners.list', true), [version])
  const [editing, setEditing] = useState<Partner | 'new' | null>(null)

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Settings</h1>
      </header>

      <PrivacySettings status={lock} onStatus={onLockStatus} />

      <section className="group">
        <h2 className="label">Partner labels</h2>
        <div className="card list-card">
          {(partners ?? []).map((p) => (
            <button key={p.id} type="button" className="row" onClick={() => setEditing(p)}>
              <span className="row-text">
                <span className={`row-title ${p.archived ? 'muted' : ''}`}>{p.label}</span>
                {p.archived && <span className="row-sub">Archived — kept on past entries</span>}
              </span>
              <Icon name="forward" size={14} color="var(--faint)" strokeWidth={2} />
            </button>
          ))}
          <button type="button" className="row" onClick={() => setEditing('new')}>
            <span className="row-text">
              <span className="row-title accent">Add label</span>
            </span>
          </button>
        </div>
      </section>

      <section className="group">
        <h2 className="label">Appearance</h2>
        <Segmented
          label="Appearance"
          options={THEMES}
          value={settings.theme}
          onChange={(theme) => theme && void api('settings.setTheme', theme).then(onSettings)}
        />
      </section>

      <p className="footnote">
        Your journal stays on this iPhone and is stored encrypted. Nothing is sent anywhere. With App lock on, it opens only with your PIN. Deleting Tide from the Home Screen deletes the
        journal — backups arrive in a coming update.
      </p>

      {editing && (
        <PartnerSheet
          partner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}

function PartnerSheet({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(partner?.label ?? '')
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save')
    }
  }
  const save = () => run(() => (partner ? api('partners.rename', partner.id, label) : api('partners.create', label)))

  return (
    <Sheet label={partner ? 'Partner label' : 'New label'} onClose={onClose}>
      <header className="sheet-header">
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
        <h1>{partner ? 'Partner label' : 'New label'}</h1>
        <button type="button" className="link strong" onClick={() => void save()}>
          Save
        </button>
      </header>
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <input className="text-input" autoFocus aria-label="Label" placeholder="Nickname or initial" maxLength={24} value={label} onChange={(e) => setLabel(e.target.value)} />
        <p className="muted small">Any nickname or initial — a real name is never needed.</p>
        {error && <p className="error-text">{error}</p>}
        {partner && (
          <button type="button" className="button secondary" onClick={() => void run(() => api('partners.setArchived', partner.id, !partner.archived))}>
            {partner.archived ? 'Show in the entry form again' : 'Archive — hide from the entry form'}
          </button>
        )}
      </form>
    </Sheet>
  )
}
