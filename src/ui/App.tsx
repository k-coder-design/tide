import { useCallback, useEffect, useState } from 'react'
import { rememberTab, tabAfterUpdate } from '../offline'
import type { LockStatus, Settings } from '../shared/types'
import { Icon, type IconName } from './components/Icon'
import { useLoad } from './components/controls'
import { api, ApiError, onLocked } from './lib/client'
import type { Overlay, Tab } from './navigation'
import { DesireSheet } from './screens/DesireSheet'
import { EntryDetail } from './screens/EntryDetail'
import { EntryForm } from './screens/EntryForm'
import { InsightsScreen } from './screens/InsightsScreen'
import { JournalScreen } from './screens/JournalScreen'
import { LockScreen } from './screens/LockScreen'
import { MissingJournal } from './screens/MissingJournal'
import { SettingsScreen } from './screens/SettingsScreen'
import { TodayScreen } from './screens/TodayScreen'

const TABS: ReadonlyArray<{ tab: Tab; label: string; icon: IconName }> = [
  { tab: 'today', label: 'Today', icon: 'today' },
  { tab: 'journal', label: 'Journal', icon: 'journal' },
  { tab: 'insights', label: 'Insights', icon: 'insights' },
  { tab: 'settings', label: 'Settings', icon: 'settings' }
]

/** Light / dark: "system" follows the phone; the choice is stored in the journal's settings. */
function applyTheme(settings: Settings | undefined): void {
  const root = document.documentElement
  if (!settings || settings.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', settings.theme)
}

/**
 * The app shell: the lock screen while Tide is locked (T21), otherwise the journal. Locking unmounts
 * every screen, so nothing read from the journal stays on screen or in the interface's state.
 */
export function App() {
  const [lock, setLock] = useState<LockStatus>()
  const [startError, setStartError] = useState<{ missing: boolean; message: string } | null>(null)
  // A new journal (after Delete all data) remounts every screen, so nothing of the old one stays in their state.
  const [generation, setGeneration] = useState(0)
  const refresh = useCallback(
    () =>
      api('lock.status').then(setLock, (reason: unknown) =>
        setStartError({
          missing: reason instanceof ApiError && reason.error.code === 'MISSING',
          message: reason instanceof Error ? reason.message : 'Something went wrong'
        })
      ),
    []
  )
  useEffect(() => {
    void refresh()
    return onLocked(() => void refresh())
  }, [refresh])
  const lockNow = useCallback(() => void api('lock.lock').then(setLock), [])
  useAutoLock(lock, lockNow)
  usePrivacyCover()
  useEffect(() => {
    // Read by the updater (src/offline.ts): with the journal open behind a lock, updates wait until Tide is off screen.
    document.documentElement.dataset.lock = !lock?.enabled ? 'off' : lock.locked ? 'locked' : 'open'
  }, [lock])

  if (startError?.missing) {
    return (
      <MissingJournal
        message={startError.message}
        onStarted={(status) => {
          setStartError(null)
          setLock(status)
        }}
      />
    )
  }
  if (startError) {
    return (
      <main className="fatal">
        <h1>Tide could not open</h1>
        <p>{startError.message}</p>
      </main>
    )
  }
  if (!lock) return <main className="app loading" aria-busy="true" />
  if (lock.locked) return <LockScreen status={lock} onUnlocked={setLock} />
  return (
    <Journal
      key={generation}
      lock={lock}
      onLock={lockNow}
      onLockStatus={setLock}
      onDeleted={(status) => {
        setLock(status)
        setGeneration((g) => g + 1)
      }}
    />
  )
}

/** Locks after the chosen time in the background — or at once, when auto-lock is "Immediately". */
function useAutoLock(lock: LockStatus | undefined, lockNow: () => void): void {
  const active = Boolean(lock?.enabled && !lock.locked)
  const minutes = lock?.autoLock ?? 1
  useEffect(() => {
    if (!active) return
    let hiddenAt: number | null = null
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        if (minutes === 0) lockNow()
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= minutes * 60_000) lockNow()
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [active, minutes, lockNow])
}

/**
 * A plain cover while Tide is off screen, so the app switcher snapshot shows only the icon. Not on window blur:
 * iOS blurs the window for its own pickers, and the cover would hide the form being filled in.
 */
function usePrivacyCover(): void {
  useEffect(() => {
    const root = document.documentElement
    const cover = () => root.classList.add('covered')
    const uncover = () => root.classList.remove('covered')
    const onVisibility = () => (document.visibilityState === 'hidden' ? cover() : uncover())
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', cover)
    window.addEventListener('pageshow', uncover)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', cover)
      window.removeEventListener('pageshow', uncover)
    }
  }, [])
}

function Journal({
  lock,
  onLock,
  onLockStatus,
  onDeleted
}: {
  lock: LockStatus
  onLock: () => void
  onLockStatus: (status: LockStatus) => void
  onDeleted: (status: LockStatus) => void
}) {
  const [tab, setTab] = useState<Tab>(() => {
    const resumed = tabAfterUpdate()
    return TABS.some((t) => t.tab === resumed) ? (resumed as Tab) : 'today'
  })
  useEffect(() => rememberTab(tab), [tab])
  const [stack, setStack] = useState<Overlay[]>([])
  // Bumped after every change, so open screens reload their data.
  const [version, setVersion] = useState(0)
  const [settings, setSettings] = useState<Settings>()
  const { error: startError } = useLoad(
    () =>
      api('settings.get').then((value) => {
        setSettings(value)
        return value
      }),
    []
  )
  useEffect(() => applyTheme(settings), [settings])

  const changed = useCallback(() => setVersion((v) => v + 1), [])
  const restored = useCallback(() => {
    changed()
    void api('settings.get').then(setSettings)
  }, [changed])
  const push = useCallback((overlay: Overlay) => setStack((s) => [...s, overlay]), [])
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), [])

  if (startError) {
    return (
      <main className="fatal">
        <h1>Tide could not open</h1>
        <p>{startError}</p>
      </main>
    )
  }
  if (!settings) return <main className="app loading" aria-busy="true" />

  return (
    <main className="app">
      <div className="tab-content">
        {tab === 'today' && <TodayScreen version={version} navigate={push} onChanged={changed} onLock={lock.enabled ? onLock : undefined} />}
        {tab === 'journal' && <JournalScreen version={version} navigate={push} />}
        {tab === 'insights' && <InsightsScreen version={version} />}
        {tab === 'settings' && (
          <SettingsScreen settings={settings} onSettings={setSettings} lock={lock} onLockStatus={onLockStatus} onRestored={restored} onDeleted={onDeleted} />
        )}
      </div>
      <nav className="tab-bar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            className={tab === t.tab ? 'on' : ''}
            aria-current={tab === t.tab ? 'page' : undefined}
            onClick={() => {
              setTab(t.tab)
              setStack([])
            }}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {stack.map((overlay, i) => (
        <OverlayView key={i} overlay={overlay} version={version} push={push} pop={pop} changed={changed} />
      ))}
    </main>
  )
}

function OverlayView({
  overlay,
  version,
  push,
  pop,
  changed
}: {
  overlay: Overlay
  version: number
  push: (overlay: Overlay) => void
  pop: () => void
  changed: () => void
}) {
  const done = () => {
    changed()
    pop()
  }
  switch (overlay.type) {
    case 'form':
      return <EntryForm kind={overlay.kind} date={overlay.date} onClose={pop} onSaved={done} />
    case 'edit':
      return <EditEntry id={overlay.id} onClose={pop} onSaved={done} />
    case 'detail':
      return (
        <div className="page-layer">
          <EntryDetail id={overlay.id} version={version} onBack={pop} onEdit={() => push({ type: 'edit', id: overlay.id })} onDeleted={done} />
        </div>
      )
    case 'desire':
      return <DesireSheet date={overlay.date} onClose={pop} onSaved={done} />
  }
}

function EditEntry({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { data, error } = useLoad(() => api('events.get', id), [id])
  if (error) return null
  return data ? <EntryForm existing={data} onClose={onClose} onSaved={onSaved} /> : null
}

