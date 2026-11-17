/**
 * Encrypted storage of the database image (docs/DATA_MODEL.md, "Storage and encryption").
 *
 * The database lives in memory; after each write its image is encrypted with AES-GCM and written
 * to one of two slots in turn. A slot holds: "TIDE" · format · generation · IV · ciphertext.
 * The header is authenticated together with the data, so a slot that was cut off mid-write or
 * altered fails to decrypt and the other slot (the previous save) is used. The newest valid slot wins.
 *
 * The data key is random (256 bits) and never stored in the clear. With the app lock off (T7,
 * the default) it is a non-extractable WebCrypto key kept by the browser (KeyStore → IndexedDB).
 */

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

export interface KeyStore {
  load(): Promise<CryptoKey | null>
  save(key: CryptoKey): Promise<void>
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
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
  private constructor(
    private readonly slots: SlotStore,
    private readonly key: CryptoKey,
    private generation: number
  ) {}

  /**
   * Opens storage and returns the last saved image (null on first launch).
   * Never starts empty over data it cannot read: that is an error, and nothing is overwritten.
   */
  static async open(slots: SlotStore, keys: KeyStore): Promise<{ vault: Vault; image: Uint8Array | null }> {
    const stored = await Promise.all([slots.read(0), slots.read(1)])
    const present = stored.filter((bytes): bytes is Uint8Array => bytes !== null && bytes.byteLength > 0)
    let key = await keys.load()
    if (!key) {
      if (present.length > 0) {
        throw new StorageError('The key to your data is missing on this phone, so the journal cannot be opened. Restore from a backup.')
      }
      key = await newDataKey()
      await keys.save(key)
      return { vault: new Vault(slots, key, 0), image: null }
    }
    const opened = (await Promise.all(present.map((bytes) => unseal(key, bytes)))).filter((slot) => slot !== null)
    if (present.length > 0 && opened.length === 0) {
      throw new StorageError('Your saved journal could not be decrypted, so it was left untouched. Restore from a backup.')
    }
    const newest = opened.sort((a, b) => b.generation - a.generation)[0]
    return { vault: new Vault(slots, key, newest?.generation ?? 0), image: newest?.plain ?? null }
  }

  /** Encrypts the image into the slot not holding the latest save, so that one survives a failed write. */
  async save(image: Uint8Array): Promise<void> {
    const generation = this.generation + 1
    const sealed = await seal(this.key, generation, image)
    await this.slots.write((generation % 2) as Slot, sealed)
    this.generation = generation
  }
}
