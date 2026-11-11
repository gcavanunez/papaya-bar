import { describe, expect, it } from 'vitest'
import { exportLibrary, importLibrary } from './backup'
import { planMigration } from './migrate'
import type { VersionData } from './model'
import {
	addVersion,
	createLibrary,
	createSession,
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
		expect(listSessions(fresh).map((s) => [s.name, s.status])).toEqual([
			['Work', 'open'],
			['Trip', 'closed'],
		])
		expect(listVersions(fresh, trip)).toHaveLength(2)
		expect((await getSessionData(fresh, trip))?.tabs).toHaveLength(2)
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

	it('merge keeps what is already there and the open session', async () => {
		const { lib } = await sample()
		const backup = await exportLibrary(lib)
		const other = createLibrary()
		const mine = await createSession(other, { name: 'Mine' }, data('https://x.com'))
		markOpen(other, mine)
		await importLibrary(other, backup, 'merge')
		expect(
			listSessions(other)
				.map((s) => s.name)
				.sort(),
		).toEqual(['Mine', 'Trip', 'Work'])
		expect(other.store.getValue('openSessionId')).toBe(mine)
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
	})
})
