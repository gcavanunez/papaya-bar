import { describe, expect, it } from 'vitest'
import { planMigration } from './migrate'
import { parsePreview, type VersionData } from './model'
import {
	MAX_VERSIONS,
	addVersion,
	applyMigration,
	createLibrary,
	createSession,
	deleteSession,
	ensureHome,
	getOpenSessionId,
	getSession,
	getSessionData,
	isMigrated,
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
		favIconUrl: `${url}/icon.png`,
		windowId: 1,
		groupId: -1,
		active: false,
	})),
	groups: [],
	windows: [{ id: 1, left: 0, top: 0, width: 1200, height: 800 }],
})

describe('library store', () => {
	it('takes a planned migration and lists it without opening versions', async () => {
		const lib = createLibrary()
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
		expect(isMigrated(lib)).toBe(false)
		await applyMigration(lib, result, 2_000)
		// Applying again (another page at the same time) changes nothing
		await applyMigration(lib, result, 2_000)
		expect(isMigrated(lib)).toBe(true)
		// Most recently used first (Home was "opened" at the fake time 1000)
		expect(listSessions(lib).map((s) => s.name)).toEqual(['Newer', 'Old', 'Home'])
		expect(listSessions(lib, { status: 'closed' }).map((s) => s.name)).toEqual(['Newer', 'Old'])
		expect(getOpenSessionId(lib)).toBe('home')
		const newer = listSessions(lib, { status: 'closed' })[0]
		expect((await getSessionData(lib, newer.id))?.tabs.map((t) => t.url)).toEqual([
			'https://b.com',
		])
		expect(Object.keys(lib.store.getTable('versions'))).toHaveLength(2)
		expect(await lib.blobs.ids()).toHaveLength(2)
	})

	it('creates a session with its first version and a preview', async () => {
		const lib = createLibrary()
		const id = await createSession(
			lib,
			{ name: 'Taxes' },
			data('https://irs.gov', 'https://irs.gov/b', 'https://x.com'),
			100,
		)
		expect(getSession(lib, id)).toMatchObject({ name: 'Taxes', status: 'closed', tabCount: 3 })
		expect(parsePreview(getSession(lib, id)!.preview).map((p) => p.url)).toEqual([
			'https://irs.gov',
			'https://x.com',
		])
		expect(listVersions(lib, id)).toEqual([
			expect.objectContaining({ reason: 'manual', tabCount: 3, createdAt: 100 }),
		])
	})

	it(`keeps the newest ${MAX_VERSIONS} versions and deletes the contents of the rest`, async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'Busy' }, data('https://v0.com'), 0)
		for (let i = 1; i <= 12; i++) {
			await addVersion(lib, id, data(`https://v${i}.com`, 'https://x.com'), 'switch', i)
		}
		const versions = listVersions(lib, id)
		expect(versions).toHaveLength(MAX_VERSIONS)
		expect(versions[0].createdAt).toBe(12)
		expect(versions.at(-1)!.createdAt).toBe(3)
		expect((await lib.blobs.ids()).sort()).toEqual(versions.map((v) => v.id).sort())
		expect(getSession(lib, id)).toMatchObject({ headVersionId: versions[0].id, tabCount: 2 })
		expect((await getSessionData(lib, id))?.tabs[0].url).toBe('https://v12.com')
	})

	it('restores an older version as a new newest one', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'S' }, data('https://first.com'), 1)
		await addVersion(lib, id, data('https://second.com'), 'close', 2)
		const first = listVersions(lib, id).at(-1)!
		await restoreVersion(lib, id, first.id, 3)
		expect(listVersions(lib, id).map((v) => v.reason)).toEqual(['restore', 'close', 'manual'])
		expect((await getSessionData(lib, id))?.tabs[0].url).toBe('https://first.com')
	})

	it('keeps one session open at a time', async () => {
		const lib = createLibrary()
		const a = await createSession(lib, { name: 'A' })
		const b = await createSession(lib, { name: 'B' })
		markOpen(lib, a, 10)
		markOpen(lib, b, 20)
		expect(getSession(lib, a)?.status).toBe('closed')
		expect(getSession(lib, b)).toMatchObject({ status: 'open', lastOpenedAt: 20 })
		expect(getOpenSessionId(lib)).toBe(b)
		setStatus(lib, b, 'archived')
		expect(getOpenSessionId(lib)).toBe('')
	})

	it('renames, and deletes a session with all its versions', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'Old name' }, data('https://a.com'))
		await addVersion(lib, id, data('https://b.com'), 'manual')
		updateSession(lib, id, { name: 'New name', description: 'notes' })
		expect(getSession(lib, id)).toMatchObject({ name: 'New name', description: 'notes' })
		markOpen(lib, id)
		await deleteSession(lib, id)
		expect(getSession(lib, id)).toBeNull()
		expect(Object.keys(lib.store.getTable('versions'))).toEqual([])
		expect(await lib.blobs.ids()).toEqual([])
		expect(getOpenSessionId(lib)).toBe('')
	})

	it('creates Home once, when first needed', () => {
		const lib = createLibrary()
		expect(ensureHome(lib)).toBe('home')
		updateSession(lib, 'home', { description: 'kept' })
		ensureHome(lib)
		expect(getSession(lib, 'home')).toMatchObject({
			name: 'Home',
			kind: 'home',
			description: 'kept',
		})
	})
})
