import { beforeEach, describe, expect, it } from 'vitest'
import type { MergeableContent } from 'tinybase'
import { installFakeChrome } from '@/test/fakeChrome'
import { sampleV1Store } from '@/test/libraryV1'
import { INDEX_KEY } from './persist'
import { openLibrary } from './runtime'
import { DEVICE_KEY } from './state'
import { createLibrary, getOpenSessionId, getSession, listSessions, type Library } from './store'
import { INDEX_V1_KEY, upgradeLibrary } from './upgrade'

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}

/** What the sample's tables should be after 1 → 2: everything kept, status moved */
function expectedTables(v1: ReturnType<typeof sampleV1Store>) {
	const tables = structuredClone(v1.getTables())
	for (const row of Object.values(tables.sessions)) {
		row.archivedAt = row.status === 'archived' ? row.updatedAt : 0
		if (row.kind === 'parked') row.kind = 'normal'
		delete row.status
	}
	return tables
}

const libraryFrom = (content: MergeableContent): Library => {
	const lib = createLibrary()
	lib.store.setMergeableContent(structuredClone(content))
	return lib
}

let fake: ReturnType<typeof installFakeChrome>
beforeEach(() => {
	fake = installFakeChrome()
})

describe('upgrading a schema 1 library', () => {
	it('loads a stored v1 index and upgrades it with nothing lost', async () => {
		const v1 = sampleV1Store()
		const stored = structuredClone(v1.getMergeableContent())
		fake.storage.set(INDEX_KEY, structuredClone(stored))

		const lib = await openLibrary()
		expect(lib.store.getTables()).toEqual(expectedTables(v1))
		expect(lib.store.getValues()).toEqual({ schemaVersion: 2, migratedAt: 90 })
		expect(getOpenSessionId(lib)).toBe('ctx-work')
		expect(
			listSessions(lib)
				.map((s) => [s.id, s.status, s.kind])
				.sort(),
		).toEqual([
			['ctx-trip', 'archived', 'normal'],
			['ctx-work', 'open', 'normal'],
			['home', 'closed', 'home'],
			['parked', 'closed', 'normal'],
			['saved-a', 'closed', 'normal'],
		])
		expect(getSession(lib, 'ctx-trip')?.archivedAt).toBe(250)

		await settle()
		// The untouched index is kept, and the device state is stored
		expect(fake.storage.get(INDEX_V1_KEY)).toEqual(stored)
		expect(fake.storage.get(DEVICE_KEY)).toEqual({ openSessionId: 'ctx-work' })
		// What is stored now opens the same way in the next page
		const later = await openLibrary()
		expect(later.store.getTables()).toEqual(expectedTables(v1))
		expect(getOpenSessionId(later)).toBe('ctx-work')
		expect(fake.storage.get(INDEX_V1_KEY)).toEqual(stored)
	})

	it('a page and the worker opening at once agree', async () => {
		const v1 = sampleV1Store()
		fake.storage.set(INDEX_KEY, structuredClone(v1.getMergeableContent()))
		const [panel, worker] = await Promise.all([openLibrary(), openLibrary()])
		await settle()
		for (const lib of [panel, worker]) {
			expect(lib.store.getTables()).toEqual(expectedTables(v1))
			expect(getOpenSessionId(lib)).toBe('ctx-work')
		}
		const later = await openLibrary()
		expect(later.store.getTables()).toEqual(expectedTables(v1))
	})

	it('changes nothing when run again', async () => {
		const lib = libraryFrom(sampleV1Store().getMergeableContent())
		await upgradeLibrary(lib)
		const once = structuredClone(lib.store.getMergeableContent())
		await upgradeLibrary(lib)
		expect(lib.store.getMergeableContent()).toEqual(once)
		// Even the link itself, if the version were somehow behind again
		const tables = lib.store.getTables()
		lib.store.setValue('schemaVersion', 1)
		await upgradeLibrary(lib)
		expect(lib.store.getTables()).toEqual(tables)
		expect(lib.store.getValue('schemaVersion')).toBe(2)
	})

	it('two copies upgrading separately merge into the same library', async () => {
		const v1 = sampleV1Store()
		const content = v1.getMergeableContent()
		const a = libraryFrom(content)
		const b = libraryFrom(content)
		await upgradeLibrary(a)
		await new Promise((resolve) => setTimeout(resolve, 5))
		await upgradeLibrary(b)
		a.store.merge(b.store)
		for (const lib of [a, b]) {
			expect(lib.store.getTables()).toEqual(expectedTables(v1))
			expect(lib.store.getValues()).toEqual({ schemaVersion: 2, migratedAt: 90 })
			expect(getOpenSessionId(lib)).toBe('ctx-work')
		}
	})

	it("keeps the device's own open session", async () => {
		const lib = libraryFrom(sampleV1Store().getMergeableContent())
		await lib.device.set({ openSessionId: 'saved-a' })
		await upgradeLibrary(lib)
		expect(getOpenSessionId(lib)).toBe('saved-a')
	})

	it('keeps a copy before changing anything, and changes nothing if it cannot', async () => {
		const lib = libraryFrom(sampleV1Store().getMergeableContent())
		const before = structuredClone(lib.store.getMergeableContent())
		const failing = () => Promise.reject(new Error('disk full'))
		await expect(upgradeLibrary(lib, { keepCopy: failing })).rejects.toThrow('disk full')
		expect(lib.store.getMergeableContent()).toEqual(before)
		expect(getOpenSessionId(lib)).toBe('')

		const order: string[] = []
		lib.store.addValuesListener(() => order.push('changed'))
		await upgradeLibrary(lib, { keepCopy: async () => void order.push('copied') })
		expect(order[0]).toBe('copied')
	})

	it('never overwrites an earlier copy, and leaves an empty library alone', async () => {
		fake.storage.set(INDEX_V1_KEY, 'the first copy')
		fake.storage.set(INDEX_KEY, structuredClone(sampleV1Store().getMergeableContent()))
		await openLibrary()
		expect(fake.storage.get(INDEX_V1_KEY)).toBe('the first copy')

		fake = installFakeChrome()
		const empty = await openLibrary()
		expect(empty.store.getValues()).toEqual({ schemaVersion: 0, migratedAt: 0 })
		expect(fake.storage.has(INDEX_V1_KEY)).toBe(false)
	})
})
