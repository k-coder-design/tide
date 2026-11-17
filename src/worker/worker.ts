import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { isApiMethod, WRITE_METHODS, type ApiHandlers } from '../shared/api'
import type { Result } from '../shared/types'
import { openMemoryDatabase } from '../core/db/wasm'
import { createContext } from '../core/domain/context'
import { DomainError, toAppError } from '../core/domain/errors'
import { createHandlers } from '../core/services'
import { StorageError, Vault } from '../core/storage/vault'
import { indexedDbKeys, opfsSlots } from './browserStorage'

/**
 * The Tide core in a Web Worker: SQLite WebAssembly in memory, loaded from the encrypted image
 * and stored encrypted again after every change (T3, T7). Calls come from src/ui/lib/client.ts.
 */
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<{ id: number; method: unknown; args: unknown[] }>) => void): void
  postMessage(message: unknown): void
}

async function start(): Promise<{ handlers: ApiHandlers; persist: () => Promise<void> }> {
  const sqlite3 = await sqlite3InitModule()
  const { vault, image } = await Vault.open(opfsSlots(), indexedDbKeys())
  const memory = openMemoryDatabase(sqlite3, image ?? undefined)
  const persist = async () => {
    try {
      await vault.save(memory.serialize())
    } catch (error) {
      console.error(error)
      throw new StorageError('The change could not be saved to the phone. Close Tide and open it again.')
    }
  }
  // Store right away: on first launch the new empty journal, after an update any schema migration.
  await persist()
  return { handlers: createHandlers(createContext(memory.db)), persist }
}

const ready = start()

/** One call at a time, so a write and its save are never interleaved with another call. */
let queue: Promise<unknown> = Promise.resolve()

scope.addEventListener('message', (event) => {
  const { id, method, args } = event.data
  queue = queue.then(async () => {
    let result: Result<unknown>
    try {
      const { handlers, persist } = await ready
      if (!isApiMethod(method)) throw new DomainError('NOT_FOUND', 'Unknown method')
      const data = (handlers[method] as (...params: unknown[]) => unknown)(...args)
      if (WRITE_METHODS.has(method)) await persist()
      result = { ok: true, data }
    } catch (error) {
      result =
        error instanceof StorageError
          ? { ok: false, error: { code: 'STORAGE', message: error.message } }
          : { ok: false, error: toAppError(error) }
    }
    scope.postMessage({ id, result })
  })
})
