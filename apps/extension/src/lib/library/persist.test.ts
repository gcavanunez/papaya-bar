import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { INDEX_KEY, startLibraryPersistence } from './persist'
import { createLibrary, createSession, deleteSession, listSessions, updateSession } from './store'

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}

/** A library as one page (or the background worker) would open it */
async function openPage() {
	const lib = createLibrary()
	const persister = await startLibraryPersistence(lib.store)
	return {
		lib,
		persister,
		names: () =>
			listSessions(lib)
				.map((s) => s.name)
				.sort(),
	}
}

let fake: ReturnType<typeof installFakeChrome>
beforeEach(() => {
	fake = installFakeChrome()
})

describe('library persistence', () => {
	it('starts empty and saves to chrome.storage', async () => {
		const panel = await openPage()
		expect(panel.names()).toEqual([])
		await createSession(panel.lib, { name: 'Taxes' })
		await settle()
		expect(Array.isArray(fake.storage.get(INDEX_KEY))).toBe(true)
		const later = await openPage()
		expect(later.names()).toEqual(['Taxes'])
	})

	it('shows one page the changes another makes', async () => {
		const panel = await openPage()
		const manager = await openPage()
		const id = await createSession(panel.lib, { name: 'Trip' })
		await settle()
		expect(manager.names()).toEqual(['Trip'])
		updateSession(manager.lib, id, { name: 'Trip to Lisbon' })
		await settle()
		expect(panel.names()).toEqual(['Trip to Lisbon'])
		await deleteSession(panel.lib, id)
		await settle()
		expect(manager.names()).toEqual([])
	})

	it('keeps both changes when two pages write at the same moment', async () => {
		const panel = await openPage()
		const manager = await openPage()
		// Neither has heard of the other's write yet
		await Promise.all([
			createSession(panel.lib, { name: 'From the panel' }),
			createSession(manager.lib, { name: 'From the manager' }),
		])
		await settle()
		expect(panel.names()).toEqual(['From the manager', 'From the panel'])
		expect(manager.names()).toEqual(['From the manager', 'From the panel'])
		// And what's stored has both, for the next page that opens
		const later = await openPage()
		expect(later.names()).toEqual(['From the manager', 'From the panel'])
	})

	it('stops listening when destroyed', async () => {
		const panel = await openPage()
		const manager = await openPage()
		await manager.persister.destroy()
		await createSession(panel.lib, { name: 'Unseen' })
		await settle()
		expect(manager.names()).toEqual([])
	})
})
