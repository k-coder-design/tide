/**
 * The backup file (phase 4, T14, T26): the whole journal, encrypted with a key from the backup password.
 *
 * The device keys never leave the phone (and do not move to a new one), so a backup has its own key:
 * PBKDF2-SHA256 from the backup password (600 000 iterations, random salt) → AES-GCM.
 * Layout: "TIDB" · format · iterations (uint32) · salt (16) — authenticated as additional data — · IV (12) · ciphertext.
 * The plaintext is the SQLite image, so a backup restores everything the journal holds.
 */
import { DomainError } from '../domain/errors'
import type { Bytes } from './lock'

export const BACKUP_ITERATIONS = 600_000
export const BACKUP_PASSWORD_MIN = 8

const MAGIC = [0x54, 0x49, 0x44, 0x42] // "TIDB" — a backup
/** "TIDP" — a backup saved without a password (T28): the header, then the SQLite image as it is. */
const PLAIN_MAGIC = [0x54, 0x49, 0x44, 0x50]
/** "TIDH" — an Apple Health import file, written on the Mac by scripts/health-import.mjs in the same layout (T27). */
export const HEALTH_MAGIC = [0x54, 0x49, 0x44, 0x48]
const FORMAT = 1
const SALT_BYTES = 16
const HEADER = 4 + 1 + 4 + SALT_BYTES
const IV_BYTES = 12

/** The key derived from the backup password, kept inside the encrypted journal so "Back up now" needs no password. */
export interface BackupKey {
  salt: Bytes
  iterations: number
  raw: Bytes
}

export function checkBackupPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < BACKUP_PASSWORD_MIN) {
    throw new DomainError('VALIDATION', `The backup password needs at least ${BACKUP_PASSWORD_MIN} characters`)
  }
  return password
}

export async function deriveBackupKey(password: string, salt?: Bytes, iterations = BACKUP_ITERATIONS): Promise<BackupKey> {
  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: useSalt, iterations }, base, 256)
  return { salt: useSalt, iterations, raw: new Uint8Array(bits) }
}

const aesKey = (raw: Bytes): Promise<CryptoKey> => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

export function sealBackup(key: BackupKey, image: Uint8Array): Promise<Bytes> {
  return seal(MAGIC, key, image)
}

async function seal(magic: number[], key: BackupKey, plain: Uint8Array): Promise<Bytes> {
  const header = new Uint8Array(HEADER)
  header.set(magic, 0)
  header[4] = FORMAT
  new DataView(header.buffer).setUint32(5, key.iterations)
  header.set(key.salt, 9)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, await aesKey(key.raw), plain as Bytes)
  )
  const out = new Uint8Array(HEADER + IV_BYTES + cipher.byteLength)
  out.set(header, 0)
  out.set(iv, HEADER)
  out.set(cipher, HEADER + IV_BYTES)
  return out
}

/** A backup without a password (T28): readable by anyone who has the file. */
export function plainBackup(image: Uint8Array): Bytes {
  const out = new Uint8Array(5 + image.byteLength)
  out.set(PLAIN_MAGIC, 0)
  out[4] = FORMAT
  out.set(image, 5)
  return out
}

/** The journal image inside a backup — encrypted or saved without a password; a clear error for another file or a wrong password. */
export async function openBackup(bytes: Uint8Array, password: string): Promise<{ image: Bytes }> {
  const file = new Uint8Array(bytes)
  if (file.byteLength > 5 && PLAIN_MAGIC.every((byte, i) => file[i] === byte)) {
    if (file[4] !== FORMAT) throw new DomainError('VALIDATION', 'This file was made by a newer Tide. Update Tide, then try again.')
    return { image: file.slice(5) }
  }
  if (MAGIC.every((byte, i) => file[i] === byte) && !password) {
    throw new DomainError('VALIDATION', 'This backup is protected by a password. Enter it to restore.')
  }
  const { plain } = await open(MAGIC, file, password, 'a Tide backup')
  return { image: plain }
}

/** The JSON inside a Health import file (T27). */
export async function openHealthFile(bytes: Uint8Array, password: string): Promise<unknown> {
  const { plain } = await open(HEALTH_MAGIC, bytes, password, 'a Tide import file from Apple Health')
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as unknown
  } catch {
    throw new DomainError('VALIDATION', 'The import file could not be read')
  }
}

async function open(magic: number[], bytes: Uint8Array, password: string, what: string): Promise<{ plain: Bytes; key: BackupKey }> {
  const file = new Uint8Array(bytes)
  if (file.byteLength < HEADER + IV_BYTES + 16 || magic.some((byte, i) => file[i] !== byte)) {
    throw new DomainError('VALIDATION', `This file is not ${what}`)
  }
  if (file[4] !== FORMAT) throw new DomainError('VALIDATION', 'This file was made by a newer Tide. Update Tide, then try again.')
  const header = file.slice(0, HEADER)
  const iterations = new DataView(header.buffer).getUint32(5)
  // A damaged header must not make the phone spin on billions of PBKDF2 rounds.
  if (iterations < 1000 || iterations > 10_000_000) throw new DomainError('VALIDATION', 'The file is damaged')
  const salt = file.slice(9, HEADER)
  const key = await deriveBackupKey(password, salt, iterations)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: file.slice(HEADER, HEADER + IV_BYTES), additionalData: header },
      await aesKey(key.raw),
      file.slice(HEADER + IV_BYTES)
    )
    return { plain: new Uint8Array(plain), key }
  } catch {
    throw new DomainError('VALIDATION', 'Wrong password, or the file is damaged')
  }
}
