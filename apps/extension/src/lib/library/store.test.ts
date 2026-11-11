import { describe, expect, it } from 'vitest'
import { planMigration } from './migrate'
import type { VersionData } from './model'
import {
	MAX_VERSIONS,
	addVersion,
	applyMigration,
	createLibraryStore,
	createSession,
	deleteSession,
	getOpenSessionId,
	getSession,
	getSessionData,
	listSessions,
	listVersions,
	markOpen,
	restoreVersion,
	setStatus,
	updateSession,
} from './store'

const data = (...urls: string[]): VersionData => ({
	tabs: urls.map((url) => ({
		url,
		title: url,
		favIconUrl: '',
		windowId: 1,
		groupId: -1,
		active: false,
	})),
	groups: [],
	windows: [{ id: 1, left: 0, top: 0, width: 1200, height: 800 }],
})

describe('library store', () => {
	it('takes a planned migration and lists it without opening versions', () => {
		const store = createLibraryStore()
		const result = planMigration({
			store: undefined,
			savedSessions: [
				[
					'08:35 am 09/24/2022',
					{ title: 'Old', tabs: [{ url: 'https://a.com', windowId: 1 }] },
				],
				[
					'08:35 am 09/24/2024',
					{ title: 'Newer', tabs: [{ url: 'https://b.com', windowId: 1 }] },
				],
			],
			now: 1_000,
		})
		applyMigration(store, result, 2_000)
		// Most recently used first (Home was "opened" at the fake time 1000)
		expect(listSessions(store).map((s) => s.name)).toEqual(['Newer', 'Old', 'Home'])
		expect(listSessions(store, { status: 'closed' }).map((s) => s.name)).toEqual([
			'Newer',
			'Old',
		])
		expect(getOpenSessionId(store)).toBe('home')
		expect(store.getValue('schemaVersion')).toBe(1)
		const newer = listSessions(store, { status: 'closed' })[0]
		expect(getSessionData(store, newer.id)?.tabs.map((t) => t.url)).toEqual(['https://b.com'])
		expect(() => applyMigration(store, result)).toThrow(/empty store/)
	})

	it('creates a session with its first version', () => {
		const store = createLibraryStore()
		const id = createSession(store, { name: 'Taxes' }, data('https://irs.gov'), 100)
		expect(getSession(store, id)).toMatchObject({
			name: 'Taxes',
			status: 'closed',
			tabCount: 1,
		})
		expect(listVersions(store, id)).toEqual([
			expect.objectContaining({ reason: 'manual', tabCount: 1, createdAt: 100 }),
		])
	})

	it(`keeps the newest ${MAX_VERSIONS} versions and points at the newest`, () => {
		const store = createLibraryStore()
		const id = createSession(store, { name: 'Busy' }, data('https://v0.com'), 0)
		for (let i = 1; i <= 12; i++)
			addVersion(store, id, data(`https://v${i}.com`, 'https://x.com'), 'switch', i)
		const versions = listVersions(store, id)
		expect(versions).toHaveLength(MAX_VERSIONS)
		expect(versions[0].createdAt).toBe(12)
		expect(versions.at(-1)!.createdAt).toBe(3)
		expect(getSession(store, id)).toMatchObject({ headVersionId: versions[0].id, tabCount: 2 })
		expect(getSessionData(store, id)?.tabs[0].url).toBe('https://v12.com')
	})

	it('restores an older version as a new newest one', () => {
		const store = createLibraryStore()
		const id = createSession(store, { name: 'S' }, data('https://first.com'), 1)
		addVersion(store, id, data('https://second.com'), 'close', 2)
		const first = listVersions(store, id).at(-1)!
		restoreVersion(store, id, first.id, 3)
		expect(listVersions(store, id).map((v) => v.reason)).toEqual(['manual', 'close', 'manual'])
		expect(getSessionData(store, id)?.tabs[0].url).toBe('https://first.com')
	})

	it('keeps one session open at a time', () => {
		const store = createLibraryStore()
		const a = createSession(store, { name: 'A' })
		const b = createSession(store, { name: 'B' })
		markOpen(store, a, 10)
		markOpen(store, b, 20)
		expect(getSession(store, a)?.status).toBe('closed')
		expect(getSession(store, b)).toMatchObject({ status: 'open', lastOpenedAt: 20 })
		expect(getOpenSessionId(store)).toBe(b)
		setStatus(store, b, 'archived')
		expect(getOpenSessionId(store)).toBe('')
	})

	it('renames, and deletes a session with all its versions', () => {
		const store = createLibraryStore()
		const id = createSession(store, { name: 'Old name' }, data('https://a.com'))
		addVersion(store, id, data('https://b.com'), 'manual')
		updateSession(store, id, { name: 'New name', description: 'notes' })
		expect(getSession(store, id)).toMatchObject({ name: 'New name', description: 'notes' })
		markOpen(store, id)
		deleteSession(store, id)
		expect(getSession(store, id)).toBeNull()
		expect(Object.keys(store.getTable('versions'))).toEqual([])
		expect(getOpenSessionId(store)).toBe('')
	})

	it('survives being saved and loaded again', () => {
		const store = createLibraryStore()
		const big = data(...Array.from({ length: 600 }, (_, i) => `https://site${i}.com/page`))
		const id = createSession(store, { name: 'Big' }, big)
		const copy = createLibraryStore()
		copy.setMergeableContent(store.getMergeableContent())
		expect(getSessionData(copy, id)).toEqual(big)
	})
})
