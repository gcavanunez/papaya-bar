import { describe, expect, it } from 'vitest'
import { sampleV1Store } from '@/test/libraryV1'
import { exportLibrary, importLibrary, type LibraryBackup } from './backup'
import { planMigration } from './migrate'
import type { VersionData } from './model'
import {
	addVersion,
	createLibrary,
	createSession,
	getOpenSessionId,
	getSession,
	getSessionData,
	listSessions,
	listVersions,
	markOpen,
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
	windows: [],
})

async function sample() {
	const lib = createLibrary()
	const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'), 1)
	await addVersion(lib, trip, data('https://flights.com', 'https://hotel.com'), 'switch', 2)
	const work = await createSession(lib, { name: 'Work' }, data('https://jira.com'), 3)
	markOpen(lib, work, 4)
	return { lib, trip, work }
}

describe('library backups', () => {
	it('round-trips sessions, versions and their contents', async () => {
		const { lib, trip } = await sample()
		const backup = JSON.parse(JSON.stringify(await exportLibrary(lib)))
		const fresh = createLibrary()
		await importLibrary(fresh, backup, 'replace')
		// Which session was open on the other browser is not part of the backup
		expect(listSessions(fresh).map((s) => [s.name, s.status])).toEqual([
			['Work', 'closed'],
			['Trip', 'closed'],
		])
		expect(getOpenSessionId(fresh)).toBe('')
		expect(listVersions(fresh, trip)).toHaveLength(2)
		expect((await getSessionData(fresh, trip))?.tabs).toHaveLength(2)
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
			versions: { w1: data('https://jira.com'), s1: data('https://saved.com') },
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
		expect(lib.store.getValues()).toEqual({ schemaVersion: 2, migratedAt: 90 })
		expect(Object.keys(lib.store.getTable('stashed'))).toEqual(['stash-1'])
		expect((await getSessionData(lib, 'saved-a'))?.tabs[0].url).toBe('https://saved.com')

		const fresh = createLibrary()
		await importLibrary(fresh, backup, 'replace')
		expect(getOpenSessionId(fresh)).toBe('')
		expect(listSessions(fresh)).toHaveLength(5)
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
		expect(lib.store.getValue('schemaVersion')).toBe(2)
		// The plan's open session (Home) is not adopted by an import
		expect(getOpenSessionId(lib)).toBe('')
		expect(lib.store.getRow('sessions', 'home')).not.toHaveProperty('status')
	})
})
