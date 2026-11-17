import type { ClientContract, ClientMethod } from '../../shared/api'
import type { AppError, Result } from '../../shared/types'

/**
 * The interface's only way to the data: calls to the core in the Web Worker (src/worker/worker.ts).
 * The interface never sees the database or the encryption key.
 */
export class ApiError extends Error {
  constructor(readonly error: AppError) {
    super(error.message)
    this.name = 'ApiError'
  }
}

const worker = new Worker(new URL('../../worker/worker.ts', import.meta.url), { type: 'module' })
const pending = new Map<number, (result: Result<unknown>) => void>()
let nextId = 0

const lockedListeners = new Set<() => void>()

/** Called when the core answers "Tide is locked" — the shell then shows the lock screen. */
export function onLocked(listener: () => void): () => void {
  lockedListeners.add(listener)
  return () => lockedListeners.delete(listener)
}

worker.addEventListener('message', (event: MessageEvent<{ id: number; result: Result<unknown> }>) => {
  const { id, result } = event.data
  if (!result.ok && result.error.code === 'LOCKED') lockedListeners.forEach((listener) => listener())
  pending.get(id)?.(result)
  pending.delete(id)
})

worker.addEventListener('error', (event) => {
  // The Worker failed to load: answer every waiting call instead of leaving the screen hanging.
  for (const resolve of pending.values()) {
    resolve({ ok: false, error: { code: 'STORAGE', message: `Tide could not start: ${event.message}` } })
  }
  pending.clear()
})

/** Calls not answered yet: an update reload waits for them, so a save is never cut off. */
export const callsInFlight = (): number => pending.size

export function api<M extends ClientMethod>(method: M, ...args: Parameters<ClientContract[M]>): Promise<ReturnType<ClientContract[M]>> {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, (result) => (result.ok ? resolve(result.data as ReturnType<ClientContract[M]>) : reject(new ApiError(result.error))))
    worker.postMessage({ id, method, args })
  })
}
