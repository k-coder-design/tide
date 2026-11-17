/**
 * Encrypted storage of the database image (docs/DATA_MODEL.md, "Storage and encryption").
 *
 * The database lives in memory; after each write its image is encrypted with AES-GCM and written
 * to one of two slots in turn. A slot holds: "TIDE" · format · generation · IV · ciphertext.
 * The header is authenticated together with the data, so a slot that was cut off mid-write or
 * altered fails to decrypt and the other slot (the previous save) is used. The newest valid slot wins.
 *
 * The data key is random (256 bits) and never stored in the clear. With the app lock off (T7,
 * the default) it is a non-extractable WebCrypto key kept by the browser (KeyStore → IndexedDB);
 * with the lock on, the store holds a LockRecord instead — the key wrapped by the PIN (lock.ts).
 */
import { isLockRecord, type LockRecord } from './lock'


const MAGIC = [0x54, 0x49, 0x44, 0x45] // "TIDE"
const FORMAT = 1
const HEADER = 4 + 1 + 8 // magic, format, generation — authenticated as additional data
const IV_BYTES = 12

export type Slot = 0 | 1

/** Two files in the phone's private storage (OPFS); null — the slot was never written. */
export interface SlotStore {
  read(slot: Slot): Promise<Uint8Array | null>
  write(slot: Slot, bytes: Uint8Array): Promise<void>
}

/** What is kept next to the journal: the plain browser key (lock off) or the wrapped one (lock on). */
export type StoredKey = CryptoKey | LockRecord

export interface KeyStore {
  load(): Promise<StoredKey | null>
  save(value: StoredKey): Promise<void>
  /** Whether a save of the journal was ever stored on this phone (T24). Kept next to the key. */
  hasSaved(): Promise<boolean>
  noteSaved(): Promise<void>
  /** Forgets the key and the note — only when starting over after the saves disappeared. */
  clear(): Promise<void>
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

/**
 * The key is on the phone and a journal was saved before, but both save files are gone — iOS or Safari cleared
 * part of the website data. Tide stops here instead of quietly starting an empty journal (T24).
 */
export class JournalMissingError extends StorageError {
  constructor() {
    super(
      'Your saved journal is no longer on this phone, although its key still is. This happens when iOS or Safari clears website data. ' +
        'Tide stopped here instead of quietly starting an empty journal.'
    )
    this.name = 'JournalMissingError'
  }
}

export async function seal(key: CryptoKey, generation: number, plain: Uint8Array): Promise<Uint8Array> {
  const header = new Uint8Array(HEADER)
  header.set(MAGIC, 0)
  header[4] = FORMAT
  new DataView(header.buffer).setBigUint64(5, BigInt(generation))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, plain as Uint8Array<ArrayBuffer>)
  )
  const out = new Uint8Array(HEADER + IV_BYTES + cipher.byteLength)
  out.set(header, 0)
  out.set(iv, HEADER)
  out.set(cipher, HEADER + IV_BYTES)
  return out
}

/** Decrypts a slot; null when it is not a Tide slot or does not decrypt with this key. */
export async function unseal(key: CryptoKey, bytes: Uint8Array): Promise<{ generation: number; plain: Uint8Array } | null> {
  if (bytes.byteLength < HEADER + IV_BYTES + 16) return null
  if (MAGIC.some((byte, i) => bytes[i] !== byte) || bytes[4] !== FORMAT) return null
  const header = bytes.slice(0, HEADER)
  const generation = Number(new DataView(header.buffer).getBigUint64(5))
  const iv = bytes.slice(HEADER, HEADER + IV_BYTES)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header },
      key,
      bytes.slice(HEADER + IV_BYTES)
    )
    return { generation, plain: new Uint8Array(plain) }
  } catch {
    return null
  }
}

export const newDataKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>

export class Vault {
  /** Whether this session has already noted in the key store that a save exists. */
  private noted = false

  private constructor(
    private readonly slots: SlotStore,
    private readonly keys: KeyStore,
    private key: CryptoKey,
    private generation: number
  ) {}

  /**
   * Opens storage and returns the last saved image (null on first launch).
   * Never starts empty over data it cannot read: that is an error, and nothing is overwritten.
   */
  static async open(slots: SlotStore, keys: KeyStore): Promise<Opened | { locked: LockRecord }> {
    const stored = await keys.load()
    // A key without saves is a first launch cut off before its first save — unless a save was noted before.
    if (stored && (await presentSlots(slots)).length === 0 && (await keys.hasSaved())) throw new JournalMissingError()
    if (isLockRecord(stored)) return { locked: stored }
    if (!stored) {
      if ((await presentSlots(slots)).length > 0) {
        throw new StorageError('The key to your data is missing on this phone, so the journal cannot be opened. Restore from a backup.')
      }
      const key = await newDataKey()
      await keys.save(key)
      return { vault: new Vault(slots, keys, key, 0), image: null }
    }
    return Vault.withKey(slots, keys, stored)
  }

  /**
   * After JournalMissingError: forgets the key (and the PIN with it) so the next start opens a new, empty journal.
   * Refuses while any save file is present, so it can never erase a journal.
   */
  static async startOver(slots: SlotStore, keys: KeyStore): Promise<void> {
    if ((await presentSlots(slots)).length > 0) throw new StorageError('The journal is still on this phone, so nothing was reset.')
    await keys.clear()
  }

  /** Opens the saves with a known key — the browser's, or the one the PIN just unwrapped. */
  static async withKey(slots: SlotStore, keys: KeyStore, key: CryptoKey): Promise<Opened> {
    const present = await presentSlots(slots)
    const opened = (await Promise.all(present.map((bytes) => unseal(key, bytes)))).filter((slot) => slot !== null)
    if (present.length > 0 && opened.length === 0) {
      throw new StorageError('Your saved journal could not be decrypted, so it was left untouched. Restore from a backup.')
    }
    const newest = opened.sort((a, b) => b.generation - a.generation)[0]
    return { vault: new Vault(slots, keys, key, newest?.generation ?? 0), image: newest?.plain ?? null }
  }

  /**
   * Moves the saves to a new data key without a moment where nothing opens: the image is first written
   * with the new key into the spare slot, then `commit` stores the new key, then the other slot follows.
   * Cut off before the commit, the old key still opens the previous save; after it, the new key opens the new one.
   */
  async rekey(key: CryptoKey, image: Uint8Array, commit: () => Promise<void>): Promise<void> {
    const generation = this.generation + 1
    await this.slots.write((generation % 2) as Slot, await seal(key, generation, image))
    await commit()
    this.key = key
    this.generation = generation
    await this.save(image)
  }

  /** Encrypts the image into the slot not holding the latest save, so that one survives a failed write. */
  async save(image: Uint8Array): Promise<void> {
    const generation = this.generation + 1
    const sealed = await seal(this.key, generation, image)
    await this.slots.write((generation % 2) as Slot, sealed)
    this.generation = generation
    if (!this.noted) {
      // Best effort: if the note fails, the next save tries again; without it Tide only loses the T24 guard.
      try {
        await this.keys.noteSaved()
        this.noted = true
      } catch (error) {
        console.error(error)
      }
    }
  }
}

export interface Opened {
  vault: Vault
  /** The last saved database image; null on first launch. */
  image: Uint8Array | null
}

async function presentSlots(slots: SlotStore): Promise<Uint8Array[]> {
  const stored = await Promise.all([slots.read(0), slots.read(1)])
  return stored.filter((bytes): bytes is Uint8Array => bytes !== null && bytes.byteLength > 0)
}
