import { useCallback, useEffect, useState } from 'react'
import { rememberTab, tabAfterUpdate } from '../offline'
import type { Settings } from '../shared/types'
import { Icon, type IconName } from './components/Icon'
import { useLoad } from './components/controls'
import { api } from './lib/client'
import type { Overlay, Tab } from './navigation'
import { DesireSheet } from './screens/DesireSheet'
import { EntryDetail } from './screens/EntryDetail'
import { EntryForm } from './screens/EntryForm'
import { InsightsScreen } from './screens/InsightsScreen'
import { JournalScreen } from './screens/JournalScreen'
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

export function App() {
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
        {tab === 'today' && <TodayScreen version={version} navigate={push} onChanged={changed} />}
        {tab === 'journal' && <JournalScreen version={version} navigate={push} />}
        {tab === 'insights' && <InsightsScreen />}
        {tab === 'settings' && <SettingsScreen settings={settings} onSettings={setSettings} />}
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

