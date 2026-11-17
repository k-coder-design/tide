import type { ApiContract, ApiMethod } from '../../shared/api'
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

worker.addEventListener('message', (event: MessageEvent<{ id: number; result: Result<unknown> }>) => {
  const { id, result } = event.data
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

export function api<M extends ApiMethod>(method: M, ...args: Parameters<ApiContract[M]>): Promise<ReturnType<ApiContract[M]>> {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, (result) => (result.ok ? resolve(result.data as ReturnType<ApiContract[M]>) : reject(new ApiError(result.error))))
    worker.postMessage({ id, method, args })
  })
}
