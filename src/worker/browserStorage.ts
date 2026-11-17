import type { KeyStore, Slot, SlotStore, StoredKey } from '../core/storage/vault'

/**
 * Browser bindings for the vault, used only inside the Worker.
 * Slots are two files in the origin private file system (OPFS), written through sync access handles
 * (available in Workers on iOS Safari). Older Safari returned promises from these methods,
 * so every call is awaited.
 */
interface SyncHandle {
  getSize(): number | Promise<number>
  read(buffer: Uint8Array, options: { at: number }): number | Promise<number>
  write(buffer: Uint8Array, options: { at: number }): number | Promise<number>
  truncate(size: number): void | Promise<void>
  flush(): void | Promise<void>
  close(): void | Promise<void>
}

type FileHandleWithSync = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> }

const SLOT_FILES = ['tide-a.bin', 'tide-b.bin'] as const
const MAX_SLOT_BYTES = 512 * 1024 * 1024

export function opfsSlots(): SlotStore {
  const handle = async (slot: Slot): Promise<SyncHandle> => {
    const dir = await navigator.storage.getDirectory()
    const file = (await dir.getFileHandle(SLOT_FILES[slot], { create: true })) as FileHandleWithSync
    return file.createSyncAccessHandle()
  }
  return {
    async read(slot) {
      const access = await handle(slot)
      try {
        const size = await access.getSize()
        if (size === 0) return null
        // A size the file cannot have (seen once as 2^64 right after a reload): fail the read, never guess.
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SLOT_BYTES) throw new Error(`Unreadable save size ${size}`)
        const bytes = new Uint8Array(size)
        await access.read(bytes, { at: 0 })
        return bytes
      } finally {
        await access.close()
      }
    },
    async write(slot, bytes) {
      const access = await handle(slot)
      try {
        await access.truncate(0)
        await access.write(bytes, { at: 0 })
        await access.flush()
      } finally {
        await access.close()
      }
    }
  }
}

const KEY_DB = 'tide-keys'
const KEY_STORE = 'keys'
const DATA_KEY = 'data'
/** Set after the first save of the journal is stored (T24). */
const SAVED_NOTE = 'saved'

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open key storage'))
  })
}

/** The non-extractable data key (lock off) or the PIN-wrapped one (lock on, T21), and the saved note (T24), in IndexedDB. */
export function indexedDbKeys(): KeyStore {
  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await openKeyDb()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, mode)
        const request = action(tx.objectStore(KEY_STORE))
        tx.oncomplete = () => resolve(request.result as T)
        tx.onerror = () => reject(tx.error ?? new Error('Key storage failed'))
      })
    } finally {
      db.close()
    }
  }
  return {
    load: async () => (await run<StoredKey | undefined>('readonly', (store) => store.get(DATA_KEY))) ?? null,
    save: async (key) => {
      await run('readwrite', (store) => store.put(key, DATA_KEY))
    },
    hasSaved: async () => (await run<unknown>('readonly', (store) => store.get(SAVED_NOTE))) === true,
    noteSaved: async () => {
      await run('readwrite', (store) => store.put(true, SAVED_NOTE))
    },
    clear: async () => {
      await run('readwrite', (store) => store.clear())
    }
  }
}
