import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { isApiMethod, isLockMethod, WRITE_METHODS, type LockContract, type LockMethod } from '../shared/api'
import type { LockStatus, Result } from '../shared/types'
import { DomainError, toAppError } from '../core/domain/errors'
import { Session } from '../core/session'
import { StorageError } from '../core/storage/vault'
import { indexedDbKeys, opfsSlots } from './browserStorage'

/**
 * The Tide core in a Web Worker: SQLite WebAssembly in memory, loaded from the encrypted image
 * and stored encrypted again after every change (T3, T7, T17). With the app lock on it starts locked
 * and opens the journal only after the PIN or Face ID (T21). Calls come from src/ui/lib/client.ts.
 */
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<{ id: number; method: unknown; args: unknown[] }>) => void): void
  postMessage(message: unknown): void
}

const ready = sqlite3InitModule().then((sqlite3) => Session.start(sqlite3, opfsSlots(), indexedDbKeys()))

type LockCalls = { [M in LockMethod]: (session: Session, ...args: Parameters<LockContract[M]>) => LockStatus | Promise<LockStatus> }

const LOCK_CALLS: LockCalls = {
  'lock.status': (s) => s.status(),
  'lock.unlockWithPin': (s, pin) => s.unlockWithPin(pin),
  'lock.unlockWithFaceId': (s, secret) => s.unlockWithFaceId(secret),
  'lock.lock': (s) => s.lock(),
  'lock.enable': (s, pin) => s.enable(pin),
  'lock.disable': (s, proof) => s.disable(proof),
  'lock.changePin': (s, current, next) => s.changePin(current, next),
  'lock.enableFaceId': (s, credentialId, prfSalt, secret) => s.enableFaceId(credentialId, prfSalt, secret),
  'lock.disableFaceId': (s) => s.disableFaceId(),
  'lock.setAutoLock': (s, minutes) => s.setAutoLock(minutes)
}

async function call(method: unknown, args: unknown[]): Promise<unknown> {
  const session = await ready
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
        error instanceof StorageError
          ? { ok: false, error: { code: 'STORAGE', message: error.message } }
          : { ok: false, error: toAppError(error) }
    }
    scope.postMessage({ id, result })
  })
})
