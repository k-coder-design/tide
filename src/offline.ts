import { callsInFlight } from './ui/lib/client'

/**
 * Offline mode and automatic updates (T20), as in Recallo: Mobile. The service worker (sw.js, generated
 * at build time by vite.config.ts) keeps the whole app on the phone.
 *
 * Tide looks for a new version when it opens, every time it comes back to the screen and every
 * 10 minutes while in use. A new version downloads in the background and takes over by itself; the page
 * then reloads to it as soon as that is safe: no form or sheet open, no text field in focus, no save
 * in progress and no touch for a few seconds — or right away when Tide leaves the screen. The tab stays
 * the same and "Tide updated" shows for a moment. Nothing being typed is lost.
 */
const CHECK_EVERY_MS = 10 * 60 * 1000
const QUIET_MS = 4000
const UPDATED_FLAG = 'tide-updated'
const TAB_KEY = 'tide-tab'

export function startOffline(): void {
  showUpdated()
  // In development the cache would hide changes.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  // The first install (no service worker controlled the page yet) is not an update: nothing to reload.
  let controlled = Boolean(navigator.serviceWorker.controller)
  let lastTouch = Date.now()
  let waiting: number | undefined
  for (const type of ['pointerdown', 'keydown', 'scroll'] as const) {
    window.addEventListener(type, () => (lastTouch = Date.now()), { capture: true, passive: true })
  }

  const busy = () =>
    Boolean(document.querySelector('.sheet-backdrop')) ||
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement ||
    callsInFlight() > 0

  const reload = () => {
    window.clearInterval(waiting)
    try {
      sessionStorage.setItem(UPDATED_FLAG, '1')
    } catch {
      // Private storage unavailable: the update still happens, only without the note.
    }
    window.location.reload()
  }

  const tryApply = () => {
    if (busy()) return
    // Off screen nobody sees the reload; on screen wait for a pause in use.
    if (document.visibilityState === 'hidden' || Date.now() - lastTouch >= QUIET_MS) reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    if (waiting !== undefined) return
    void isCurrentBuild().then((current) => {
      // Opened online, the page may already be the new build: the new worker only took over the cache.
      if (current) return
      waiting = window.setInterval(tryApply, 1000)
      document.addEventListener('visibilitychange', tryApply)
      tryApply()
    })
  })

  void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
    const check = () => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', check)
    window.setInterval(check, CHECK_EVERY_MS)
  })
}

/**
 * True when this page's program file belongs to the build now in the cache. The new worker takes over
 * as soon as it starts activating, before it removes the old caches, so wait for activation to finish.
 */
async function isCurrentBuild(): Promise<boolean> {
  await whenActivated(navigator.serviceWorker.controller)
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]')
  if (!script) return false
  try {
    return Boolean(await caches.match(script.src, { ignoreSearch: true, ignoreVary: true }))
  } catch {
    return false
  }
}

let resumeTab: string | null = null

function whenActivated(worker: ServiceWorker | null): Promise<void> {
  if (!worker || worker.state === 'activated' || worker.state === 'redundant') return Promise.resolve()
  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') resolve()
    })
  })
}

/** After an update reload: remember the tab to reopen and show a short note. */
function showUpdated(): void {
  try {
    if (sessionStorage.getItem(UPDATED_FLAG) !== '1') return
    sessionStorage.removeItem(UPDATED_FLAG)
    resumeTab = sessionStorage.getItem(TAB_KEY)
  } catch {
    return
  }
  const toast = document.createElement('div')
  toast.className = 'update-toast'
  toast.setAttribute('role', 'status')
  toast.textContent = 'Tide updated'
  document.body.append(toast)
  window.setTimeout(() => toast.remove(), 2500)
}

/** The tab that was open before an update reload; null after a normal launch, which starts on Today. */
export const tabAfterUpdate = (): string | null => resumeTab

/** Remembered for the session only, so an update reload can come back to the same tab. */
export function rememberTab(tab: string): void {
  try {
    sessionStorage.setItem(TAB_KEY, tab)
  } catch {
    // Not available: an update reload then opens Today.
  }
}

/**
 * Ask the browser to keep the data persistently: otherwise iOS may clear the storage of a site
 * that has not been used for a long time. For a Home Screen app it is usually granted right away.
 */
export function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined)
}
