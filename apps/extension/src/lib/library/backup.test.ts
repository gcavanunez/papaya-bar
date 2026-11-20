import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { sampleV1Store } from '@/test/libraryV1'
import { sampleV2Entries, sampleV2Store } from '@/test/libraryV2'
import { exportLibrary, importLibrary, type LibraryBackup } from './backup'
import { planMigration } from './migrate'
import type { SessionContent } from './model'
import {
	addStashed,
	createLibrary,
	createSession,
	getCheckpointData,
	getOpenSessionId,
	getSession,
	getSessionData,
	listCheckpoints,
	listSessions,
	markOpen,
	referencedEntries,
	setContent,
	type Library,
} from './store'

const data = (...urls: string[]): SessionContent => ({
	tabs: urls.map((url) => ({
		url,
		title: url,
		favIconUrl: '',
		windowId: 1,
		groupId: -1,
		active: false,
	})),
	groups: [],
	windows: [],
})

async function sample() {
	const lib = createLibrary()
	const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'), 1)
	await setContent(lib, trip, data('https://flights.com', 'https://hotel.com'), 'always', {
		now: 2,
	})
	const work = await createSession(lib, { name: 'Work' }, data('https://jira.com'), 3)
	await addStashed(lib, work, { name: 'Docs', color: 'blue' }, data('https://docs.com').tabs, 3)
	markOpen(lib, work, 4)
	return { lib, trip, work }
}

/** Every stored entry is one the index refers to, and the other way round */
async function expectOwned(lib: Library) {
	expect((await lib.blobs.ids()).sort()).toEqual([...referencedEntries(lib)].sort())
}

beforeEach(() => {
	installFakeChrome()
})

describe('library backups', () => {
	it('round-trips sessions, contents, checkpoints and stashed groups', async () => {
		const { lib, trip, work } = await sample()
		const exported = await exportLibrary(lib)
		// Everything the index refers to, and nothing else
		expect(Object.keys(exported.versions).sort()).toEqual([...referencedEntries(lib)].sort())
		expect(Object.keys(exported.versions)).toHaveLength(4)
		const backup = JSON.parse(JSON.stringify(exported))
		const fresh = createLibrary()
		const summary = await importLibrary(fresh, backup, 'replace')
		expect(summary).toEqual({ sessions: 2, checkpoints: 1 })
		// Which session was open on the other browser is not part of the backup
		expect(listSessions(fresh).map((s) => [s.name, s.status])).toEqual([
			['Work', 'closed'],
			['Trip', 'closed'],
		])
		expect(getOpenSessionId(fresh)).toBe('')
		expect(listCheckpoints(fresh, trip)).toHaveLength(1)
		expect((await getSessionData(fresh, trip))?.tabs).toHaveLength(2)
		expect(
			(await getCheckpointData(fresh, listCheckpoints(fresh, trip)[0].id))?.tabs,
		).toHaveLength(1)
		expect(Object.values(fresh.store.getTable('stashed'))[0]).toMatchObject({
			sessionId: work,
			name: 'Docs',
		})
		await expectOwned(fresh)
	})

	it('replace keeps the open session when the backup has it too', async () => {
		const { lib, work } = await sample()
		const backup = await exportLibrary(lib)
		await importLibrary(lib, backup, 'replace')
		expect(getOpenSessionId(lib)).toBe(work)
	})

	it('replace leaves no open session when the open one is gone', async () => {
		const { lib } = await sample()
		const backup = await exportLibrary(lib)
		const other = createLibrary()
		await markOpen(other, await createSession(other, { name: 'Only here' }))
		await importLibrary(other, backup, 'replace')
		expect(getOpenSessionId(other)).toBe('')
		expect(listSessions(other, { status: 'open' })).toEqual([])
	})

	it('replace removes what the backup does not have, contents included', async () => {
		const { lib } = await sample()
		const backup = await exportLibrary(lib)
		const other = createLibrary()
		await createSession(other, { name: 'Only here' }, data('https://x.com'))
		await importLibrary(other, backup, 'replace')
		expect(
			listSessions(other)
				.map((s) => s.name)
				.sort(),
		).toEqual(['Trip', 'Work'])
		expect((await other.blobs.ids()).sort()).toEqual(Object.keys(backup.versions).sort())
		await expectOwned(other)
	})

	it('merge keeps what is already there and exactly one open session, unchanged', async () => {
		const { lib } = await sample()
		const backup = await exportLibrary(lib)
		const other = createLibrary()
		const mine = await createSession(other, { name: 'Mine' }, data('https://x.com'))
		await markOpen(other, mine)
		await importLibrary(other, backup, 'merge')
		expect(
			listSessions(other)
				.map((s) => s.name)
				.sort(),
		).toEqual(['Mine', 'Trip', 'Work'])
		expect(getOpenSessionId(other)).toBe(mine)
		expect(listSessions(other, { status: 'open' }).map((s) => s.name)).toEqual(['Mine'])
		await expectOwned(other)
	})

	it("merge keeps a session's own content as a checkpoint when the backup replaces it", async () => {
		const { lib, trip } = await sample()
		const older = JSON.parse(JSON.stringify(await exportLibrary(lib)))
		// Since that backup, Trip changed twice; its first content is now a checkpoint here
		await setContent(lib, trip, data('https://museum.com'), 'always', { now: 10 })
		const mine = getSession(lib, trip)!.contentId
		await importLibrary(lib, older, 'merge', 20)
		// The backup's Trip wins, and what was here is kept
		expect((await getSessionData(lib, trip))?.tabs.map((t) => t.url)).toEqual([
			'https://flights.com',
			'https://hotel.com',
		])
		const kept = listCheckpoints(lib, trip)
		expect(kept.find((c) => c.id === mine)).toMatchObject({ reason: 'import', createdAt: 20 })
		expect((await getCheckpointData(lib, mine))?.tabs.map((t) => t.url)).toEqual([
			'https://museum.com',
		])
		// The backup's content was a checkpoint here too: each now has its own entry
		const contentId = getSession(lib, trip)!.contentId
		expect(kept.map((c) => c.id)).not.toContain(contentId)
		await expectOwned(lib)
	})

	it('two libraries merging their indexes each keep their own open session', async () => {
		const laptop = createLibrary()
		const desktop = createLibrary()
		const trip = await createSession(laptop, { name: 'Trip' }, data('https://flights.com'))
		desktop.store.merge(laptop.store)
		const taxes = await createSession(desktop, { name: 'Taxes' }, data('https://irs.gov'))
		laptop.store.merge(desktop.store)

		await markOpen(laptop, trip, 10)
		await new Promise((resolve) => setTimeout(resolve, 5))
		await markOpen(desktop, taxes, 20)
		laptop.store.merge(desktop.store)

		expect(getOpenSessionId(laptop)).toBe(trip)
		expect(getOpenSessionId(desktop)).toBe(taxes)
		expect(listSessions(laptop, { status: 'open' }).map((s) => s.name)).toEqual(['Trip'])
		expect(listSessions(desktop, { status: 'open' }).map((s) => s.name)).toEqual(['Taxes'])
	})

	it('imports a backup written before the open session was per device', async () => {
		const v1 = sampleV1Store()
		const backup: LibraryBackup = {
			index: v1.getMergeableContent(),
			versions: {
				w1: data('https://jira.com'),
				s1: data('https://saved.com'),
				'stash-1': data('https://docs.com'),
			},
		}
		const lib = createLibrary()
		const mine = await createSession(lib, { name: 'Mine' })
		await markOpen(lib, mine)
		await importLibrary(lib, JSON.parse(JSON.stringify(backup)), 'merge')
		expect(getOpenSessionId(lib)).toBe(mine)
		expect(listSessions(lib, { status: 'open' }).map((s) => s.name)).toEqual(['Mine'])
		expect(getSession(lib, 'ctx-trip')).toMatchObject({ status: 'archived', archivedAt: 250 })
		expect(getSession(lib, 'parked')?.kind).toBe('normal')
		expect(lib.store.getRow('sessions', 'ctx-work')).not.toHaveProperty('status')
		expect(lib.store.getValues()).toEqual({ schemaVersion: 3, migratedAt: 90 })
		expect(Object.keys(lib.store.getTable('stashed'))).toEqual(['stash-1'])
		expect(getSession(lib, 'ctx-work')?.contentId).toBe('w1')
		// w0's entry was not in this backup: nothing points at it
		expect(listCheckpoints(lib, 'ctx-work')).toEqual([])
		expect((await getSessionData(lib, 'saved-a'))?.tabs[0].url).toBe('https://saved.com')

		const fresh = createLibrary()
		await importLibrary(fresh, backup, 'replace')
		expect(getOpenSessionId(fresh)).toBe('')
		expect(listSessions(fresh)).toHaveLength(5)
	})

	it('a backup missing some entries imports nothing that points at them', async () => {
		const { lib, trip, work } = await sample()
		const backup = await exportLibrary(lib)
		const stashId = Object.keys(lib.store.getTable('stashed'))[0]
		const checkpointId = listCheckpoints(lib, trip)[0].id
		delete backup.versions[getSession(lib, work)!.contentId]
		delete backup.versions[stashId]
		delete backup.versions[checkpointId]
		const fresh = createLibrary()
		await importLibrary(fresh, JSON.parse(JSON.stringify(backup)), 'replace')
		expect(getSession(fresh, work)).toMatchObject({ contentId: '', tabCount: 0 })
		expect(fresh.store.getTable('stashed')).toEqual({})
		expect(listCheckpoints(fresh, trip)).toEqual([])
		expect((await getSessionData(fresh, trip))?.tabs).toHaveLength(2)
		await expectOwned(fresh)
	})

	it('imports a backup written at schema 2 through the upgrade', async () => {
		const backup: LibraryBackup = JSON.parse(
			JSON.stringify({
				index: sampleV2Store().getMergeableContent(),
				versions: sampleV2Entries(),
			}),
		)
		const lib = createLibrary()
		const mine = await createSession(lib, { name: 'Mine' }, data('https://x.com'))
		await markOpen(lib, mine)
		const summary = await importLibrary(lib, backup, 'merge')
		expect(summary).toEqual({ sessions: 4, checkpoints: 3 })
		expect(getOpenSessionId(lib)).toBe(mine)
		expect(lib.store.getValue('schemaVersion')).toBe(3)
		expect(getSession(lib, 'work')?.contentId).toBe('w2')
		expect(listCheckpoints(lib, 'work').map((c) => c.id)).toEqual(['w1', 'w0'])
		expect(getSession(lib, 'lost')).toMatchObject({ contentId: '', tabCount: 0 })
		expect((await getSessionData(lib, 'trip'))?.tabs[0].url).toBe('https://flights.com')
		expect(lib.store.getTable('versions')).toEqual({})
		await expectOwned(lib)
	})

	it('imports an old-format backup through the migration', async () => {
		const result = planMigration({
			store: undefined,
			savedSessions: [
				[
					'08:35 am 09/24/2022',
					{ title: 'Old', tabs: [{ url: 'https://a.com', windowId: 1 }] },
				],
			],
		})
		const lib = createLibrary()
		await importLibrary(lib, result, 'replace')
		expect(
			listSessions(lib)
				.map((s) => s.name)
				.sort(),
		).toEqual(['Home', 'Old'])
		expect(lib.store.getValue('migratedAt')).toBeGreaterThan(0)
		expect(lib.store.getValue('schemaVersion')).toBe(3)
		expect(
			(await getSessionData(lib, listSessions(lib).find((s) => s.name === 'Old')!.id))?.tabs,
		).toHaveLength(1)
		// The plan's open session (Home) is not adopted by an import
		expect(getOpenSessionId(lib)).toBe('')
		expect(lib.store.getRow('sessions', 'home')).not.toHaveProperty('status')
		expect(lib.device.get().adoptLive).toBe(false)
		await expectOwned(lib)
	})
})
