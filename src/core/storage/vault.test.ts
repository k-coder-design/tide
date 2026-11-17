import { describe, expect, it } from 'vitest'
import { openTestContext, openTestMemory } from '../testing'
import { CheckinService } from '../domain/checkins'
import { newDataKey, seal, unseal, Vault, type KeyStore, type Slot, type SlotStore } from './vault'

function memorySlots(): SlotStore & { data: Array<Uint8Array | null> } {
  const data: Array<Uint8Array | null> = [null, null]
  return {
    data,
    read: async (slot: Slot) => data[slot] ?? null,
    write: async (slot: Slot, bytes: Uint8Array) => {
      data[slot] = bytes.slice()
    }
  }
}

function memoryKeys(): KeyStore & { key: CryptoKey | null } {
  const store = {
    key: null as CryptoKey | null,
    load: async () => store.key,
    save: async (key: CryptoKey) => {
      store.key = key
    }
  }
  return store
}

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array | null) => (data ? new TextDecoder().decode(data) : null)

describe('encrypted storage', () => {
  it('sealed data is not readable and decrypts only with its key', async () => {
    const key = await newDataKey()
    const sealed = await seal(key, 3, bytes('desire 7'))
    expect(new TextDecoder().decode(sealed)).not.toContain('desire 7')
    expect(await unseal(key, sealed)).toEqual({ generation: 3, plain: bytes('desire 7') })
    expect(await unseal(await newDataKey(), sealed)).toBeNull()
  })

  it('a changed or cut slot does not decrypt, header included', async () => {
    const key = await newDataKey()
    const sealed = await seal(key, 1, bytes('journal'))
    const flipped = sealed.slice()
    flipped[sealed.length - 1]! ^= 1
    expect(await unseal(key, flipped)).toBeNull()
    const otherGeneration = sealed.slice()
    otherGeneration[12]! ^= 1
    expect(await unseal(key, otherGeneration)).toBeNull()
    expect(await unseal(key, sealed.slice(0, 20))).toBeNull()
  })

  it('first launch creates a key; saves alternate slots and the newest wins', async () => {
    const slots = memorySlots()
    const keys = memoryKeys()
    const first = await Vault.open(slots, keys)
    expect(first.image).toBeNull()
    expect(keys.key).not.toBeNull()
    await first.vault.save(bytes('one'))
    await first.vault.save(bytes('two'))
    expect(slots.data.every((slot) => slot !== null)).toBe(true)
    expect(text((await Vault.open(slots, keys)).image)).toBe('two')
  })

  it('a save cut off mid-write falls back to the previous one', async () => {
    const slots = memorySlots()
    const keys = memoryKeys()
    const { vault } = await Vault.open(slots, keys)
    await vault.save(bytes('one'))
    await vault.save(bytes('two'))
    slots.data[0] = slots.data[0]!.slice(0, 30) // generation 2 lives in slot 0
    const reopened = await Vault.open(slots, keys)
    expect(text(reopened.image)).toBe('one')
    // The next save goes to the damaged slot, never over the last good one.
    await reopened.vault.save(bytes('three'))
    expect(text((await Vault.open(slots, keys)).image)).toBe('three')
  })

  it('never starts empty over data it cannot read', async () => {
    const slots = memorySlots()
    const keys = memoryKeys()
    const { vault } = await Vault.open(slots, keys)
    await vault.save(bytes('journal'))
    await expect(Vault.open(slots, memoryKeys())).rejects.toThrow(/key to your data is missing/)
    keys.key = await newDataKey()
    await expect(Vault.open(slots, keys)).rejects.toThrow(/could not be decrypted/)
  })

  it('the database survives a save and reload through the vault', async () => {
    const slots = memorySlots()
    const keys = memoryKeys()
    const memory = openTestMemory()
    const ctx = { ...openTestContext(), db: memory.db }
    new CheckinService(ctx).setDesire('2026-11-17', 7)
    const { vault } = await Vault.open(slots, keys)
    await vault.save(memory.serialize())
    const { image } = await Vault.open(slots, keys)
    const restored = openTestMemory(image!)
    expect(new CheckinService({ ...ctx, db: restored.db }).desire('2026-11-17')).toBe(7)
  })
})
