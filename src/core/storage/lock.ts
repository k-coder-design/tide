/**
 * The optional app lock (T7, T21, T22): the data key wrapped by the PIN.
 *
 * With the lock on, the data key exists in the clear only in the Worker's memory while Tide is open.
 * On the phone it is kept as 32 random bytes encrypted (AES-GCM) with a key derived from the PIN
 * (PBKDF2-SHA256, 600 000 iterations, random salt). A wrong PIN is detected by the authenticated
 * decryption failing; nothing else reveals it.
 */

export const PIN_LENGTH = 4
export const PIN_ITERATIONS = 600_000
/** Minutes in the background before Tide locks; 0 — as soon as it leaves the screen. */
export const AUTO_LOCK_OPTIONS = [0, 1, 5, 15] as const
export type AutoLock = (typeof AUTO_LOCK_OPTIONS)[number]
export const DEFAULT_AUTO_LOCK: AutoLock = 1

/** Bytes backed by a plain ArrayBuffer, as WebCrypto wants them. */
export type Bytes = Uint8Array<ArrayBuffer>

const KEY_BYTES = 32
const IV_BYTES = 12

interface Wrapped {
  iv: Bytes
  data: Bytes
}

export interface PinWrap extends Wrapped {
  salt: Bytes
  iterations: number
}

/** Stored next to the encrypted journal (IndexedDB) instead of the plain key when the lock is on. */
export interface LockRecord {
  kind: 'lock'
  version: 1
  pin: PinWrap
  autoLock: AutoLock
  /** Wrong PINs in a row and the moment (ms since 1970) the next try is allowed. */
  failed: number
  retryAt: number
}

export const isLockRecord = (value: unknown): value is LockRecord =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'lock'

export const isPin = (pin: unknown): pin is string => typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)

export const isAutoLock = (value: unknown): value is AutoLock => (AUTO_LOCK_OPTIONS as readonly unknown[]).includes(value)

export const newRawKey = (): Bytes => crypto.getRandomValues(new Uint8Array(KEY_BYTES))

/** The data key for encrypting saves; it cannot be read back out of WebCrypto. */
export const importDataKey = (raw: Bytes): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

async function pinKey(pin: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
}

async function wrap(key: CryptoKey, raw: Bytes): Promise<Wrapped> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  return { iv, data: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw)) }
}

async function unwrap(key: CryptoKey, wrapped: Wrapped): Promise<Bytes | null> {
  try {
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.iv }, key, wrapped.data))
    return raw.byteLength === KEY_BYTES ? raw : null
  } catch {
    return null
  }
}

export async function wrapWithPin(raw: Bytes, pin: string, iterations = PIN_ITERATIONS): Promise<PinWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { salt, iterations, ...(await wrap(await pinKey(pin, salt, iterations), raw)) }
}

/** The raw data key, or null when the PIN is wrong. */
export async function unwrapWithPin(pinWrap: PinWrap, pin: string): Promise<Bytes | null> {
  return unwrap(await pinKey(pin, pinWrap.salt, pinWrap.iterations), pinWrap)
}

/**
 * Wrong PINs: four tries freely, then a wait that grows — 30 s, 1 min, 5 min, then 15 min after each one.
 * Kept with the lock record, so closing Tide does not reset it.
 */
export function afterWrongPin(record: LockRecord, now: number): LockRecord {
  const failed = record.failed + 1
  const waits = [0, 0, 0, 0, 30, 60, 300]
  const seconds = failed <= waits.length ? waits[failed - 1]! : 900
  return { ...record, failed, retryAt: seconds > 0 ? now + seconds * 1000 : 0 }
}
