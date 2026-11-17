import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { openMemoryDatabase, type MemoryDatabase } from './db/wasm'
import type { Context } from './domain/context'
import type { KeyStore, Slot, SlotStore, StoredKey } from './storage/vault'

/** Test helpers: the same SQLite WebAssembly as on the phone, a fixed clock and readable ids. */
let sqlite3: Sqlite3Static | undefined

export async function loadSqlite(): Promise<Sqlite3Static> {
  sqlite3 ??= await sqlite3InitModule()
  return sqlite3
}

export function openTestMemory(image?: Uint8Array): MemoryDatabase {
  if (!sqlite3) throw new Error('Call loadSqlite() first (vitest setup does it)')
  return openMemoryDatabase(sqlite3, image)
}

export function openTestContext(): Context & { tick(): void } {
  const memory = openTestMemory()
  let seconds = 0
  let ids = 0
  return {
    db: memory.db,
    now: () => new Date(Date.UTC(2026, 10, 17, 12, 0, seconds)).toISOString(),
    newId: () => `id-${++ids}`,
    tick: () => {
      seconds++
    }
  }
}

/** Storage fakes: the two save slots and the key store, in memory. */
export function memorySlots(): SlotStore & { data: Array<Uint8Array | null> } {
  const data: Array<Uint8Array | null> = [null, null]
  return {
    data,
    read: async (slot: Slot) => data[slot] ?? null,
    write: async (slot: Slot, bytes: Uint8Array) => {
      data[slot] = bytes.slice()
    }
  }
}

export function memoryKeys(): KeyStore & { key: StoredKey | null } {
  const store = {
    key: null as StoredKey | null,
    load: async () => store.key,
    save: async (key: StoredKey) => {
      store.key = key
    }
  }
  return store
}
