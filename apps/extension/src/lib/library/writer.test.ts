import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { sampleV1Store } from '@/test/libraryV1'
import { exportLibrary } from './backup'
import { VERSION_KEY_PREFIX } from './blobs'
import { COMMAND_MESSAGE, createLibraryClient, type LibraryClient } from './client'
import { planMigration } from './migrate'
import type { SessionContent } from './model'
import { INDEX_KEY } from './persist'
import {
	addStashed,
	applyMigration,
	createLibrary,
	createSession,
	ensureHome,
	getLink,
	getOpenSessionId,
	getSession,
	getSessionData,
	getStashedTabs,
	isMigrated,
	listCheckpoints,
	listSessions,
	markOpen,
	referencedEntries,
	setContent,
	setLink,
	updateSession,
	type Library,
} from './store'
import { INDEX_V1_KEY } from './upgrade'
import { createLibraryWriter, type LibraryWriter } from './writer'

const OWN_PAGE = 'chrome-extension://papaya-test/index.html#/panel'

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
	windows: [{ id: 1, left: 0, top: 0, width: 1200, height: 800 }],
})

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const urlsOf = (d: SessionContent | null) => d?.tabs.map((t) => t.url)

let fake: ReturnType<typeof installFakeChrome>
let writer: LibraryWriter
/** A page: the side panel, say */
let client: LibraryClient

beforeEach(async () => {
	fake = installFakeChrome()
	writer = createLibraryWriter()
	chrome.runtime.onMessage.addListener(writer.onMessage)
	client = createLibraryClient()
	await fake.seedWindow([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
})

// A test's worker stops with it, so nothing it still hears writes into the next test's storage
afterEach(() => fake.stopWorker())

/** Library contents set up by the worker, as if saved earlier */
function seed<T>(work: (lib: Library) => Promise<T>): Promise<T> {
	return writer.enqueue(work)
}

describe('commands from a page', () => {
	it("are visible in the page's copy as soon as the call resolves", async () => {
		await seed((lib) => markOpen(lib, ensureHome(lib)))
		const page = await client.getLibrary()

		const id = await client.send('saveCopy', {})
		expect(getSession(page, id)).toMatchObject({
			name: 'home-a.com, home-b.com',
			status: 'closed',
			tabCount: 2,
		})
		expect(urlsOf(await getSessionData(page, id))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])

		const research = await client.send('saveOpenAs', { name: 'Research' })
		// Device state too: the open session changed in the worker
		expect(getOpenSessionId(page)).toBe(research)
		expect(getSession(page, research)?.status).toBe('open')
	})

	it('run one after the other, even while one waits on Chrome', async () => {
		const trip = await seed(async (lib) => {
			await markOpen(lib, ensureHome(lib))
			return createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		})
		const page = await client.getLibrary()
		// Asked together: the save must see the switch finished, not half done
		const [switched, checkpoint] = await Promise.all([
			client.send('switchTo', { sessionId: trip }),
			client.send('saveCheckpoint'),
		])
		expect(switched).toEqual({ fromId: 'home', toId: trip, failed: [] })
		expect(getOpenSessionId(page)).toBe(trip)
		expect(listCheckpoints(page, 'home')).toEqual([])
		// The checkpoint is of Trip, which was open by then. Saving what was open first kept
		// Trip's content from before the switch: its first checkpoint.
		expect(listCheckpoints(page, trip).map((c) => [c.id, c.reason])).toEqual([
			[checkpoint, 'manual'],
			[expect.any(String), 'autosave'],
		])
		expect(urlsOf(await getSessionData(page, trip))).toEqual(['https://flights.com'])
		expect(urlsOf(await getSessionData(page, 'home'))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
	})

	it('queue: each piece of work finishes before the next starts, and failures do not stop it', async () => {
		const order: string[] = []
		const slow = writer.enqueue(async () => {
			order.push('slow starts')
			await wait(30)
			order.push('slow ends')
		})
		const failing = writer.enqueue(async () => {
			order.push('failing')
			throw new Error('nope')
		})
		const quick = writer.enqueue(async () => void order.push('quick'))
		await expect(failing).rejects.toThrow('nope')
		await Promise.all([slow, quick])
		expect(order).toEqual(['slow starts', 'slow ends', 'failing', 'quick'])
	})

	it("reject with the worker's error message", async () => {
		await client.getLibrary()
		await expect(client.send('switchTo', { sessionId: 'nope' })).rejects.toThrow(
			'That session no longer exists',
		)
		const reply = await chrome.runtime.sendMessage({ type: COMMAND_MESSAGE, name: 'toString' })
		expect(reply).toEqual({ ok: false, error: 'Unknown library command: toString' })
	})

	it('the worker saves the index before it answers', async () => {
		await client.getLibrary()
		const id = await client.send('createSession', { fields: { name: 'Taxes' } })
		const stored = createLibrary()
		stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
		expect(getSession(stored, id)?.name).toBe('Taxes')
	})
})

describe("a page's copy", () => {
	it('cannot write, and never changes what is stored', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'Trip' }, data('https://a.com')))
		const page = await client.getLibrary()
		await settle()
		const before = structuredClone(Object.fromEntries(fake.storage))

		expect(() => updateSession(page, id, { name: 'Changed' })).toThrow(
			/cannot change the library \(setPartialRow\)/,
		)
		await expect(createSession(page, { name: 'New' })).rejects.toThrow(/cannot change/)
		expect(() => page.store.transaction(() => undefined)).toThrow(/cannot change/)
		expect(() => page.store.delTables()).toThrow(/cannot change/)
		expect(() => markOpen(page, id)).toThrow(/cannot change/)
		await expect(setContent(page, id, data('https://b.com'), 'never')).rejects.toThrow(
			/cannot change saved tabs/,
		)
		await expect(page.runtime.set({ link: 'linked' })).rejects.toThrow(
			/cannot change library:runtime/,
		)
		await expect(page.blobs.delete(['x'])).rejects.toThrow(/cannot change saved tabs/)
		await expect(page.device.set({ openSessionId: id })).rejects.toThrow(
			/cannot change library:device/,
		)

		await settle()
		expect(Object.fromEntries(fake.storage)).toEqual(before)
		expect(getSession(page, id)?.name).toBe('Trip')
		expect(getOpenSessionId(page)).toBe('')
	})

	it('follows what the worker changes without asking', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'Trip' }, data('https://a.com')))
		const stashId = await seed((lib) =>
			addStashed(lib, id, { name: 'Docs', color: 'blue' }, data('https://docs.com').tabs),
		)
		const page = await client.getLibrary()
		expect((await getStashedTabs(page, stashId)).map((t) => t.url)).toEqual([
			'https://docs.com',
		])

		// As the website palette would: straight to the worker, not through this page
		await writer.run('updateSession', { id, fields: { name: 'Trip to Lisbon' } })
		await writer.run('removeStashed', { id: stashId })
		await writer.enqueue((lib) => markOpen(lib, id))
		await writer.enqueue((lib) => setLink(lib, 'unlinked'))
		await settle()
		expect(getSession(page, id)?.name).toBe('Trip to Lisbon')
		expect(getOpenSessionId(page)).toBe(id)
		// Whether the open windows are its tabs, for the page's banner
		expect(getLink(page)).toBe('unlinked')
		// The cached tabs go once the worker deletes them
		expect(await page.blobs.get(stashId)).toBeNull()

		await writer.run('deleteSession', { id })
		await settle()
		expect(listSessions(page)).toEqual([])
	})

	it('merges what is stored, never replacing what it has that is newer', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'First' }))
		const page = await client.getLibrary()
		const older = structuredClone(fake.storage.get(INDEX_KEY))
		await client.send('updateSession', { id, fields: { name: 'Second' } })
		const other = await client.send('createSession', { fields: { name: 'Other' } })

		// An old index arrives late (a stale write, or a change heard out of order)
		await chrome.storage.local.set({ [INDEX_KEY]: older })
		await settle()
		expect(getSession(page, id)?.name).toBe('Second')
		expect(getSession(page, other)?.name).toBe('Other')
		// The worker merged it too, and stored the result again
		const stored = createLibrary()
		stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
		expect(getSession(stored, id)?.name).toBe('Second')
		expect(getSession(stored, other)?.name).toBe('Other')
	})
})

describe('opening', () => {
	it('a page waits for the worker to open the library', async () => {
		chrome.runtime.onMessage.removeListener(writer.onMessage)
		await expect(client.getLibrary()).rejects.toThrow(/Receiving end does not exist/)
		chrome.runtime.onMessage.addListener(writer.onMessage)
		expect(listSessions(await client.getLibrary())).toEqual([])
	})

	it('a failed upgrade keeps the library closed; the next open tries again', async () => {
		fake.storage.set(INDEX_KEY, structuredClone(sampleV1Store().getMergeableContent()))
		const stored = structuredClone(fake.storage.get(INDEX_KEY))
		const set = fake.chrome.storage.local.set
		let full = true
		fake.chrome.storage.local.set = async (items: Record<string, unknown>) => {
			if (full && INDEX_V1_KEY in items) throw new Error('disk full')
			return set(items)
		}

		await expect(client.getLibrary()).rejects.toThrow('disk full')
		await expect(writer.library()).rejects.toThrow('disk full')
		await expect(client.send('saveCheckpoint')).rejects.toThrow('disk full')
		await settle()
		// Nothing was written over the old index
		expect(fake.storage.get(INDEX_KEY)).toEqual(stored)
		expect(fake.storage.has(INDEX_V1_KEY)).toBe(false)

		full = false
		const page = await client.getLibrary()
		expect(page.store.getValue('schemaVersion')).toBe(3)
		expect(getOpenSessionId(page)).toBe('ctx-work')
		expect(fake.storage.get(INDEX_V1_KEY)).toEqual(stored)
	})
})

describe('the move-in and backups, applied by the worker', () => {
	it('moves in a plan the page made, losing nothing on the way', async () => {
		const plan = planMigration({
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
		const page = await client.getLibrary()
		expect(isMigrated(page)).toBe(false)
		await client.send('moveIn', { plan })

		expect(isMigrated(page)).toBe(true)
		expect(getOpenSessionId(page)).toBe('home')
		const direct = createLibrary()
		await applyMigration(direct, plan)
		expect(page.store.getTables()).toEqual(direct.store.getTables())
		const newer = listSessions(page, { status: 'closed' })[0]
		expect(urlsOf(await getSessionData(page, newer.id))).toEqual(['https://b.com'])

		// A second plan, late (another page asked too), does not reset what was saved since
		await client.send('saveEdits', { sessionId: newer.id, data: data('https://edited.com') })
		await client.send('moveIn', { plan })
		expect(urlsOf(await getSessionData(page, newer.id))).toEqual(['https://edited.com'])
	})

	it('imports a backup the page read', async () => {
		const other = createLibrary()
		const trip = await createSession(other, { name: 'Trip' }, data('https://flights.com'), 1)
		await setContent(other, trip, data('https://flights.com', 'https://hotel.com'), 'always', {
			now: 2,
		})
		const backup = await exportLibrary(other)
		await seed((lib) => createSession(lib, { name: 'Only here' }, data('https://x.com')))

		const page = await client.getLibrary()
		const summary = await client.send('importLibrary', { source: backup, mode: 'replace' })
		expect(summary).toEqual({ sessions: 1, checkpoints: 1 })
		expect(listSessions(page).map((s) => s.name)).toEqual(['Trip'])
		expect(urlsOf(await getSessionData(page, trip))).toEqual([
			'https://flights.com',
			'https://hotel.com',
		])
		const entries = [...fake.storage.keys()].filter((k) => k.startsWith(VERSION_KEY_PREFIX))
		expect(entries.sort()).toEqual(
			Object.keys(backup.versions)
				.map((id) => VERSION_KEY_PREFIX + id)
				.sort(),
		)
	})
})

describe('what the worker stores', () => {
	it('work that changes nothing writes nothing', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'Trip' }, data('https://a.com')))
		await settle()
		const writes: string[] = []
		const set = fake.chrome.storage.local.set
		fake.chrome.storage.local.set = async (items: Record<string, unknown>) => {
			writes.push(...Object.keys(items))
			return set(items)
		}
		await writer.enqueue((lib) => setContent(lib, id, data('https://a.com'), 'always'))
		await writer.enqueue(async (lib) => getSession(lib, id))
		await settle()
		expect(writes).toEqual([])
		await writer.run('updateSession', { id, fields: { name: 'Lisbon' } })
		expect(writes).toEqual([INDEX_KEY])
	})

	it('deletes an entry only once the stored index no longer refers to it', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'Trip' }, data('https://a.com')))
		const lib = await writer.library()
		const old = getSession(lib, id)!.contentId
		const remove = fake.chrome.storage.local.remove
		const storedRefs: string[][] = []
		fake.chrome.storage.local.remove = async (keys: string | string[]) => {
			const stored = createLibrary()
			stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
			storedRefs.push([...referencedEntries(stored)])
			return remove(keys)
		}
		// Many steps in one piece of work: nothing is deleted until the end
		await writer.enqueue(async (lib) => {
			await setContent(lib, id, data('https://b.com'), 'never')
			expect(await lib.blobs.get(old)).not.toBeNull()
			await setContent(lib, id, data('https://c.com'), 'never')
		})
		expect(storedRefs).toHaveLength(1)
		expect(storedRefs[0]).not.toContain(old)
		expect(fake.storage.has(VERSION_KEY_PREFIX + old)).toBe(false)
		// Every stored entry is one the stored index refers to
		const entries = [...fake.storage.keys()].filter((k) => k.startsWith(VERSION_KEY_PREFIX))
		expect(entries).toEqual([VERSION_KEY_PREFIX + getSession(lib, id)!.contentId])
	})

	it('a worker stopped before saving leaves nothing the stored index points at missing', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'Trip' }, data('https://a.com')))
		const lib = await writer.library()
		// The work runs, but the worker stops before the index is stored
		await setContent(lib, id, data('https://b.com'), 'never')
		const stored = createLibrary()
		stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
		for (const entry of referencedEntries(stored))
			expect(fake.storage.has(VERSION_KEY_PREFIX + entry)).toBe(true)
	})
})

describe('when the index cannot be stored', () => {
	/** Make writes of the index fail until `fixed()` */
	function failIndexWrites() {
		const set = fake.chrome.storage.local.set
		let failing = true
		fake.chrome.storage.local.set = async (items: Record<string, unknown>) => {
			if (failing && INDEX_KEY in items) throw new Error('QUOTA_BYTES quota exceeded')
			return set(items)
		}
		return () => void (failing = false)
	}
	const storedIndex = () => {
		const stored = createLibrary()
		stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
		return stored
	}
	function expectStoredIndexWhole() {
		for (const entry of referencedEntries(storedIndex()))
			expect(fake.storage.has(VERSION_KEY_PREFIX + entry), entry).toBe(true)
	}

	it('keeps the old entries, the command rejects, and the next save catches up', async () => {
		const id = await seed((lib) => createSession(lib, { name: 'Trip' }, data('https://a.com')))
		const page = await client.getLibrary()
		// The first edit keeps a.com as a checkpoint; a second within minutes keeps nothing
		await client.send('saveEdits', { sessionId: id, data: data('https://b.com') })
		const b = getSession(page, id)!.contentId

		const fixed = failIndexWrites()
		await expect(
			client.send('saveEdits', { sessionId: id, data: data('https://c.com') }),
		).rejects.toThrow(/could not save your sessions \(QUOTA_BYTES quota exceeded\)/)
		await settle()
		// What is stored is as before, whole: b.com is still the content, and still there
		expect(getSession(storedIndex(), id)?.contentId).toBe(b)
		expect(fake.storage.has(VERSION_KEY_PREFIX + b)).toBe(true)
		expectStoredIndexWhole()
		// Still failing: another command fails too, and still deletes nothing
		await expect(
			client.send('updateSession', { id, fields: { name: 'Lisbon' } }),
		).rejects.toThrow(/could not save/)
		expect(fake.storage.has(VERSION_KEY_PREFIX + b)).toBe(true)

		fixed()
		await client.send('updateSession', { id, fields: { name: 'Lisbon' } })
		const stored = storedIndex()
		expect(getSession(stored, id)).toMatchObject({ name: 'Lisbon' })
		expect(urlsOf(await getSessionData(page, id))).toEqual(['https://c.com'])
		// Only now that the index no longer refers to it is b.com's entry deleted
		expect(fake.storage.has(VERSION_KEY_PREFIX + b)).toBe(false)
		expectStoredIndexWhole()
		const entries = [...fake.storage.keys()].filter((k) => k.startsWith(VERSION_KEY_PREFIX))
		expect(entries.sort()).toEqual(
			[...referencedEntries(stored)].map((e) => VERSION_KEY_PREFIX + e).sort(),
		)
	})

	it('an upgrade that cannot be stored keeps the library closed', async () => {
		fake.storage.set(INDEX_KEY, structuredClone(sampleV1Store().getMergeableContent()))
		const before = structuredClone(fake.storage.get(INDEX_KEY))
		const fixed = failIndexWrites()
		await expect(writer.library()).rejects.toThrow(/could not save your sessions/)
		expect(fake.storage.get(INDEX_KEY)).toEqual(before)
		fixed()
		expect((await writer.library()).store.getValue('schemaVersion')).toBe(3)
	})
})
