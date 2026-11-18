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

const MAGIC = [0x54, 0x49, 0x44, 0x42] // "TIDB"
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

export async function sealBackup(key: BackupKey, image: Uint8Array): Promise<Bytes> {
  const header = new Uint8Array(HEADER)
  header.set(MAGIC, 0)
  header[4] = FORMAT
  new DataView(header.buffer).setUint32(5, key.iterations)
  header.set(key.salt, 9)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, await aesKey(key.raw), image as Bytes)
  )
  const out = new Uint8Array(HEADER + IV_BYTES + cipher.byteLength)
  out.set(header, 0)
  out.set(iv, HEADER)
  out.set(cipher, HEADER + IV_BYTES)
  return out
}

/** The journal image inside a backup and the key that opened it; a clear error for another file or a wrong password. */
export async function openBackup(bytes: Uint8Array, password: string): Promise<{ image: Bytes; key: BackupKey }> {
  const file = new Uint8Array(bytes)
  if (file.byteLength < HEADER + IV_BYTES + 16 || MAGIC.some((byte, i) => file[i] !== byte)) {
    throw new DomainError('VALIDATION', 'This file is not a Tide backup')
  }
  if (file[4] !== FORMAT) throw new DomainError('VALIDATION', 'This backup was made by a newer Tide. Update Tide, then try again.')
  const header = file.slice(0, HEADER)
  const iterations = new DataView(header.buffer).getUint32(5)
  const salt = file.slice(9, HEADER)
  const key = await deriveBackupKey(password, salt, iterations)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: file.slice(HEADER, HEADER + IV_BYTES), additionalData: header },
      await aesKey(key.raw),
      file.slice(HEADER + IV_BYTES)
    )
    return { image: new Uint8Array(plain), key }
  } catch {
    throw new DomainError('VALIDATION', 'Wrong backup password, or the file is damaged')
  }
}
