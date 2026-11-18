import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { isApiMethod, isLockMethod, WRITE_METHODS, type LockContract, type LockMethod, type StorageContract, type StorageMethod } from '../shared/api'
import type { LockStatus, Result } from '../shared/types'
import { DomainError, toAppError } from '../core/domain/errors'
import { Session } from '../core/session'
import { JournalMissingError, StorageError } from '../core/storage/vault'
import { indexedDbKeys, opfsSlots } from './browserStorage'

/**
 * The Tide core in a Web Worker: SQLite WebAssembly in memory, loaded from the encrypted image
 * and stored encrypted again after every change (T3, T7, T17). With the app lock on it starts locked
 * and opens the journal only after the PIN (T21). Calls come from src/ui/lib/client.ts.
 */
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<{ id: number; method: unknown; args: unknown[] }>) => void): void
  postMessage(message: unknown): void
}

const START_TRIES = 5

/**
 * Opens storage, retrying a few times: right after a reload the previous page's Worker may still hold the save
 * files for a moment. Retrying is safe — nothing is written until the journal has opened. A missing key or
 * undecryptable saves (StorageError) are not retried: they do not get better by waiting.
 */
async function start(open: typeof Session.start = Session.start): Promise<Session> {
  const sqlite3 = await sqlite3InitModule()
  for (let attempt = 1; ; attempt++) {
    try {
      return await open(sqlite3, opfsSlots(), indexedDbKeys())
    } catch (error) {
      if (error instanceof StorageError) throw error
      console.warn(`Tide could not open storage (try ${attempt} of ${START_TRIES})`, error)
      if (attempt >= START_TRIES) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        throw new StorageError(`Tide could not open its storage (${reason}). Close Tide fully and open it again.`)
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt))
    }
  }
}

let ready = start()
// Errors reach the interface through the first call; keep the rejection from being reported as unhandled.
ready.catch(() => undefined)

type LockCalls = { [M in LockMethod]: (session: Session, ...args: Parameters<LockContract[M]>) => LockStatus | Promise<LockStatus> }

const LOCK_CALLS: LockCalls = {
  'lock.status': (s) => s.status(),
  'lock.unlockWithPin': (s, pin) => s.unlockWithPin(pin),
  'lock.lock': (s) => s.lock(),
  'lock.enable': (s, pin) => s.enable(pin),
  'lock.disable': (s, pin) => s.disable(pin),
  'lock.changePin': (s, current, next) => s.changePin(current, next),
  'lock.setAutoLock': (s, minutes) => s.setAutoLock(minutes)
}

type StorageCalls = {
  [M in Exclude<StorageMethod, 'storage.startOver' | 'storage.deleteAll'>]: (session: Session, ...args: Parameters<StorageContract[M]>) => ReturnType<StorageContract[M]> | Promise<ReturnType<StorageContract[M]>>
}

const STORAGE_CALLS: StorageCalls = {
  'backup.setPassword': (s, password) => s.setBackupPassword(password),
  'backup.create': (s) => s.createBackup(),
  'backup.restore': (s, file, password, mode) => s.restoreBackup(file, password, mode)
}

const isStorageCall = (method: unknown): method is keyof StorageCalls => typeof method === 'string' && Object.hasOwn(STORAGE_CALLS, method)

async function call(method: unknown, args: unknown[]): Promise<unknown> {
  if (method === 'storage.startOver') {
    // Only after the saves disappeared (T24); the vault refuses while any save is present.
    ready = start((sqlite3, slots, keys) => Session.startOver(sqlite3, slots, keys))
    ready.catch(() => undefined)
    return (await ready).status()
  }
  const session = await ready
  if (method === 'storage.deleteAll') {
    await session.deleteAll()
    ready = start()
    ready.catch(() => undefined)
    return (await ready).status()
  }
  if (isStorageCall(method)) return (STORAGE_CALLS[method] as (s: Session, ...a: unknown[]) => unknown)(session, ...args)
  if (isLockMethod(method)) return (LOCK_CALLS[method] as (s: Session, ...a: unknown[]) => unknown)(session, ...args)
  if (!isApiMethod(method)) throw new DomainError('NOT_FOUND', 'Unknown method')
  const data = (session.handlers()[method] as (...params: unknown[]) => unknown)(...args)
  if (WRITE_METHODS.has(method)) await session.persist()
  return data
}

/** One call at a time, so a write and its save are never interleaved with another call or a lock. */
let queue: Promise<unknown> = Promise.resolve()

scope.addEventListener('message', (event) => {
  const { id, method, args } = event.data
  queue = queue.then(async () => {
    let result: Result<unknown>
    try {
      result = { ok: true, data: await call(method, args) }
    } catch (error) {
      result =
        error instanceof JournalMissingError
          ? { ok: false, error: { code: 'MISSING', message: error.message } }
          : error instanceof StorageError
          ? { ok: false, error: { code: 'STORAGE', message: error.message } }
          : { ok: false, error: toAppError(error) }
    }
    scope.postMessage({ id, result })
  })
})
