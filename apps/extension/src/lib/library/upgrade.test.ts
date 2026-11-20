import { beforeEach, describe, expect, it } from 'vitest'
import type { MergeableContent, MergeableStore } from 'tinybase'
import { installFakeChrome } from '@/test/fakeChrome'
import { sampleV1Store } from '@/test/libraryV1'
import { sampleV2Entries, sampleV2Store, tabsOf } from '@/test/libraryV2'
import { VERSION_KEY_PREFIX } from './blobs'
import { INDEX_KEY } from './persist'
import { createLibraryClient } from './client'
import type { SessionContent } from './model'
import { openLibrary } from './runtime'
import { DEVICE_KEY } from './state'
import {
	createLibrary,
	getOpenSessionId,
	getSession,
	getSessionData,
	listCheckpoints,
	listSessions,
	referencedEntries,
	type Library,
} from './store'
import { INDEX_V1_KEY, UNKNOWN_SCHEMA_ERROR, upgradeLibrary } from './upgrade'
import libraryErrorCard from '@/components/LibraryError.vue?raw'
import { createLibraryWriter } from './writer'

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}

type Tables = ReturnType<MergeableStore['getTables']>

/**
 * What an old index's tables should be at schema 3: everything kept; status moved
 * (schema 1); each newest version that is stored becomes its session's content, every
 * other stored version a checkpoint; nothing points at an entry that is not stored
 */
function expectedTables(old: MergeableStore, stored: string[]): Tables {
	const tables = structuredClone(old.getTables())
	const heads = new Set<string>()
	for (const row of Object.values(tables.sessions)) {
		if (row.status !== undefined) {
			row.archivedAt = row.status === 'archived' ? row.updatedAt : 0
			delete row.status
		}
		if (row.kind === 'parked') row.kind = 'normal'
		const head = String(row.headVersionId ?? '')
		delete row.headVersionId
		heads.add(head)
		if (stored.includes(head)) {
			row.contentId = head
		} else {
			row.contentId = ''
			if (head) Object.assign(row, { tabCount: 0, preview: '[]' })
		}
	}
	const checkpoints: Tables[string] = {}
	for (const [id, row] of Object.entries(tables.versions ?? {})) {
		if (!heads.has(id) && stored.includes(id)) checkpoints[id] = row
	}
	delete tables.versions
	if (Object.keys(checkpoints).length) tables.checkpoints = checkpoints
	return tables
}

const libraryFrom = (content: MergeableContent, entries: Record<string, SessionContent> = {}) => {
	const lib = createLibrary()
	lib.store.setMergeableContent(structuredClone(content))
	void lib.blobs.set(entries)
	return lib
}

/** Entries stored as the extension stores them */
function storeEntries(entries: Record<string, SessionContent>) {
	for (const [id, data] of Object.entries(entries))
		fake.storage.set(VERSION_KEY_PREFIX + id, JSON.stringify(data))
}

const V1_ENTRIES = {
	w1: tabsOf('https://jira.com'),
	w0: tabsOf('https://old-jira.com'),
	s1: tabsOf('https://saved.com'),
	'stash-1': tabsOf('https://docs.com'),
}

let fake: ReturnType<typeof installFakeChrome>
beforeEach(() => {
	fake = installFakeChrome()
})

describe('upgrading a schema 1 library', () => {
	it('loads a stored v1 index and upgrades it through both links with nothing lost', async () => {
		const v1 = sampleV1Store()
		const stored = structuredClone(v1.getMergeableContent())
		fake.storage.set(INDEX_KEY, structuredClone(stored))
		storeEntries(V1_ENTRIES)

		const { lib } = await openLibrary()
		const expected = expectedTables(v1, Object.keys(V1_ENTRIES))
		expect(lib.store.getTables()).toEqual(expected)
		expect(lib.store.getValues()).toEqual({ schemaVersion: 3, migratedAt: 90 })
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
		expect(getSession(lib, 'ctx-work')?.contentId).toBe('w1')
		expect(listCheckpoints(lib, 'ctx-work').map((c) => [c.id, c.reason])).toEqual([
			['w0', 'manual'],
		])
		expect((await getSessionData(lib, 'saved-a'))?.tabs[0].url).toBe('https://saved.com')

		await settle()
		// The untouched index is kept, and the device state is stored
		expect(fake.storage.get(INDEX_V1_KEY)).toEqual(stored)
		expect(fake.storage.get(DEVICE_KEY)).toEqual({ openSessionId: 'ctx-work', adoptLive: true })
		// What is stored now opens the same way in the next page
		const { lib: later } = await openLibrary()
		expect(later.store.getTables()).toEqual(expected)
		expect(getOpenSessionId(later)).toBe('ctx-work')
		expect(fake.storage.get(INDEX_V1_KEY)).toEqual(stored)
	})

	it('a page and the worker opening at once agree', async () => {
		const v1 = sampleV1Store()
		fake.storage.set(INDEX_KEY, structuredClone(v1.getMergeableContent()))
		storeEntries(V1_ENTRIES)
		const writer = createLibraryWriter()
		chrome.runtime.onMessage.addListener(writer.onMessage)
		// The page waits for the worker to open (and upgrade) before it reads
		const [panel, worker] = await Promise.all([
			createLibraryClient().getLibrary(),
			writer.library(),
		])
		await settle()
		const expected = expectedTables(v1, Object.keys(V1_ENTRIES))
		for (const lib of [panel, worker]) {
			expect(lib.store.getTables()).toEqual(expected)
			// The page's fresh store has default values, but the stored ones win
			expect(lib.store.getValues()).toEqual({ schemaVersion: 3, migratedAt: 90 })
			expect(getOpenSessionId(lib)).toBe('ctx-work')
		}
		const { lib: later } = await openLibrary()
		expect(later.store.getTables()).toEqual(expected)
	})

	it('changes nothing when run again', async () => {
		const lib = libraryFrom(sampleV1Store().getMergeableContent(), V1_ENTRIES)
		await upgradeLibrary(lib)
		const once = structuredClone(lib.store.getMergeableContent())
		await upgradeLibrary(lib)
		expect(lib.store.getMergeableContent()).toEqual(once)
		// Even the links themselves, if the version were somehow behind again
		const tables = lib.store.getTables()
		lib.store.setValue('schemaVersion', 1)
		await upgradeLibrary(lib)
		expect(lib.store.getTables()).toEqual(tables)
		expect(lib.store.getValue('schemaVersion')).toBe(3)
	})

	it('two copies upgrading separately merge into the same library', async () => {
		const v1 = sampleV1Store()
		const content = v1.getMergeableContent()
		const a = libraryFrom(content, V1_ENTRIES)
		const b = libraryFrom(content, V1_ENTRIES)
		await upgradeLibrary(a)
		await new Promise((resolve) => setTimeout(resolve, 5))
		await upgradeLibrary(b)
		a.store.merge(b.store)
		for (const lib of [a, b]) {
			expect(lib.store.getTables()).toEqual(expectedTables(v1, Object.keys(V1_ENTRIES)))
			expect(lib.store.getValues()).toEqual({ schemaVersion: 3, migratedAt: 90 })
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
		const { lib: empty } = await openLibrary()
		expect(empty.store.getValues()).toEqual({ schemaVersion: 0, migratedAt: 0 })
		expect(fake.storage.has(INDEX_V1_KEY)).toBe(false)
		expect(fake.storage.has(INDEX_KEY)).toBe(false)
		expect(fake.storage.get(DEVICE_KEY)).toBeUndefined()
	})
})

describe('upgrading a schema 2 library', () => {
	const V2_STORED = Object.keys(sampleV2Entries())

	it('loads a stored v2 index: newest versions become contents, the rest checkpoints', async () => {
		const v2 = sampleV2Store()
		const stored = structuredClone(v2.getMergeableContent())
		fake.storage.set(INDEX_KEY, structuredClone(stored))
		fake.storage.set(DEVICE_KEY, { openSessionId: 'work' })
		storeEntries(sampleV2Entries())

		const { lib } = await openLibrary()
		const expected = expectedTables(v2, V2_STORED)
		expect(lib.store.getTables()).toEqual(expected)
		expect(lib.store.getValues()).toEqual({ schemaVersion: 3, migratedAt: 90 })
		expect(getSession(lib, 'work')).toMatchObject({ contentId: 'w2', tabCount: 2 })
		expect(listCheckpoints(lib, 'work').map((c) => [c.id, c.reason, c.createdAt])).toEqual([
			['w1', 'manual', 150],
			['w0', 'migrated', 120],
		])
		expect(getSession(lib, 'trip')).toMatchObject({ contentId: 't1', archivedAt: 250 })
		expect(listCheckpoints(lib, 'trip')).toEqual([])
		// Its newest version was never stored: no content, rather than one that points at nothing
		expect(getSession(lib, 'lost')).toMatchObject({ contentId: '', tabCount: 0, preview: '[]' })
		expect(listCheckpoints(lib, 'lost').map((c) => c.id)).toEqual(['l0'])
		expect(getSession(lib, 'home')).toMatchObject({ contentId: '', description: 'notes' })
		// Every entry has one owner, and every owner's entry is stored
		const owned = [...referencedEntries(lib)].sort()
		expect(owned).toEqual([...V2_STORED].sort())

		await settle()
		expect(fake.storage.get(DEVICE_KEY)).toEqual({ openSessionId: 'work', adoptLive: true })
		expect(fake.storage.get(INDEX_V1_KEY)).toEqual(stored)
		// Nothing was deleted
		for (const id of V2_STORED) expect(fake.storage.has(VERSION_KEY_PREFIX + id)).toBe(true)

		// Opening again finds it upgraded and writes nothing
		const before = structuredClone(fake.storage.get(INDEX_KEY))
		const { lib: later } = await openLibrary()
		await settle()
		expect(later.store.getTables()).toEqual(expected)
		expect(fake.storage.get(INDEX_KEY)).toEqual(before)
	})

	it('changes nothing when run again, even from schema 2 again', async () => {
		const lib = libraryFrom(sampleV2Store().getMergeableContent(), sampleV2Entries())
		await upgradeLibrary(lib)
		const once = structuredClone(lib.store.getMergeableContent())
		await upgradeLibrary(lib)
		expect(lib.store.getMergeableContent()).toEqual(once)
		const tables = lib.store.getTables()
		lib.store.setValue('schemaVersion', 2)
		await upgradeLibrary(lib)
		expect(lib.store.getTables()).toEqual(tables)
		expect(lib.store.getValue('schemaVersion')).toBe(3)
	})

	it('keeps a content written since, making the old newest version a checkpoint', async () => {
		const lib = libraryFrom(sampleV2Store().getMergeableContent(), {
			...sampleV2Entries(),
			fresh: tabsOf('https://fresh.com'),
		})
		lib.store.setCell('sessions', 'work', 'contentId', 'fresh')
		await upgradeLibrary(lib)
		expect(getSession(lib, 'work')?.contentId).toBe('fresh')
		expect(listCheckpoints(lib, 'work').map((c) => c.id)).toEqual(['w2', 'w1', 'w0'])
	})

	it('two copies upgrading separately merge into the same library', async () => {
		const v2 = sampleV2Store()
		const a = libraryFrom(v2.getMergeableContent(), sampleV2Entries())
		const b = libraryFrom(v2.getMergeableContent(), sampleV2Entries())
		await upgradeLibrary(a)
		await new Promise((resolve) => setTimeout(resolve, 5))
		await upgradeLibrary(b)
		a.store.merge(b.store)
		for (const lib of [a, b] as Library[]) {
			expect(lib.store.getTables()).toEqual(expectedTables(v2, V2_STORED))
		}
	})

	it('refuses an index at a version it does not know, in plain words, changing nothing', async () => {
		for (const schemaVersion of [99, 2.5, -1]) {
			fake = installFakeChrome()
			const v2 = sampleV2Store()
			v2.setValue('schemaVersion', schemaVersion)
			const stored = structuredClone(v2.getMergeableContent())
			fake.storage.set(INDEX_KEY, structuredClone(stored))
			fake.storage.set(DEVICE_KEY, { openSessionId: 'work' })
			storeEntries(sampleV2Entries())
			const keys = [...fake.storage.keys()].sort()

			await expect(openLibrary()).rejects.toThrow(UNKNOWN_SCHEMA_ERROR)
			// What a page shows as the reason
			chrome.runtime.onMessage.addListener(createLibraryWriter().onMessage)
			await expect(createLibraryClient().getLibrary()).rejects.toThrow(UNKNOWN_SCHEMA_ERROR)
			await settle()
			expect(fake.storage.get(INDEX_KEY)).toEqual(stored)
			expect(fake.storage.get(DEVICE_KEY)).toEqual({ openSessionId: 'work' })
			expect([...fake.storage.keys()].sort()).toEqual(keys)
		}
		expect(UNKNOWN_SCHEMA_ERROR).toMatch(/newer version of Papaya/)
	})

	it('the could-not-open card says once that nothing was changed', () => {
		const said = (text: string) => text.match(/nothing was changed/gi)?.length ?? 0
		expect(said(libraryErrorCard)).toBe(1)
		expect(said(UNKNOWN_SCHEMA_ERROR)).toBe(0)
	})

	it('a failed upgrade leaves what is stored untouched', async () => {
		const v2 = sampleV2Store()
		fake.storage.set(INDEX_KEY, structuredClone(v2.getMergeableContent()))
		storeEntries(sampleV2Entries())
		const getKeys = fake.chrome.storage.local.getKeys
		fake.chrome.storage.local.getKeys = () => Promise.reject(new Error('storage is busy'))
		await expect(openLibrary()).rejects.toThrow('storage is busy')
		await settle()
		expect(fake.storage.get(INDEX_KEY)).toEqual(v2.getMergeableContent())
		fake.chrome.storage.local.getKeys = getKeys
		const { lib } = await openLibrary()
		expect(lib.store.getValue('schemaVersion')).toBe(3)
	})
})
