import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { sampleV2Entries, sampleV2Store, tabsOf } from '@/test/libraryV2'
import { captureOpen, putAway } from './actions'
import {
	MAX_WAIT_MS,
	QUIET_MS,
	RETITLE_QUIET_MS,
	createAutosaver,
	type Autosaver,
	type TickResult,
} from './autosave'
import { VERSION_KEY_PREFIX } from './blobs'
import type { SessionContent } from './model'
import { INDEX_KEY } from './persist'
import { DEVICE_KEY, RUNTIME_KEY } from './state'
import {
	createSession,
	getCheckpointData,
	getLink,
	getOpenSessionId,
	getSession,
	getSessionData,
	listCheckpoints,
	listSessions,
	markOpen,
	referencedEntries,
	type Library,
} from './store'
import { createLibraryWriter, type LibraryWriter } from './writer'

const OWN_PAGE = 'chrome-extension://papaya-test/index.html#/panel'
const TRIP = ['https://flights.com', 'https://hotel.com', 'https://museum.com']

let fake: ReturnType<typeof installFakeChrome>
let writer: LibraryWriter
let autosave: Autosaver
/** What the worker wrote to storage.local and storage.session, by key */
let writes: string[]

/** A worker starting: the library writer, its autosaver, and the tick it runs at once */
function startWorker(): Promise<TickResult> {
	writer = createLibraryWriter()
	chrome.runtime.onMessage.addListener(writer.onMessage)
	autosave = createAutosaver(writer)
	return autosave.tick()
}

/** Chrome stops the worker (idle, or the extension reloads) and later starts a new one */
function stopWorker() {
	vi.clearAllTimers()
	fake.stopWorker()
}

const lib = (): Promise<Library> => writer.library()
/** Let the waits run out, then let the work they queued finish */
async function wait(ms: number) {
	await vi.advanceTimersByTimeAsync(ms)
	await writer.enqueue(async () => undefined)
}
const urlsOf = (d: SessionContent | null) => d?.tabs.map((t) => t.url) ?? []
const contentOf = async (id: string) => urlsOf(await getSessionData(await lib(), id))
/** The tabs the open windows hold, as a person would list them */
const openUrls = () =>
	fake
		.snapshot()
		.flatMap((w) => w.tabs.map((t) => t.url))
		.filter((url) => url !== OWN_PAGE)

async function openTab(url: string, windowId?: number) {
	await chrome.tabs.create({ url, windowId, active: false })
	autosave.changed()
}

/** Every address kept for a session: its content and every checkpoint */
async function everythingKept(id: string) {
	const library = await lib()
	const kept = new Set(await contentOf(id))
	for (const c of listCheckpoints(library, id))
		for (const url of urlsOf(await getCheckpointData(library, c.id))) kept.add(url)
	return kept
}

/** Every entry the stored index refers to is stored */
async function expectStoredIndexWhole() {
	const { createLibrary } = await import('./store')
	const stored = createLibrary()
	stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
	for (const id of referencedEntries(stored))
		expect(fake.storage.has(VERSION_KEY_PREFIX + id), id).toBe(true)
}

/**
 * A moved-in library with Trip open, its tabs in a window and saved as they are, and
 * the worker's first tick done
 */
async function tripIsOpen() {
	await fake.seedWindow([OWN_PAGE, ...TRIP])
	await startWorker()
	const id = await writer.enqueue(async (library) => {
		library.store.setValues({ schemaVersion: 3, migratedAt: 1 })
		const s = await createSession(library, { name: 'Trip' }, await captureOpen(), 1)
		await markOpen(library, s, 1)
		return s
	})
	expect(await autosave.tick()).toBe('unchanged')
	expect(getLink(await lib())).toBe('linked')
	return id
}

/** How many ticks autosave asked for */
function countTicks() {
	const enqueue = vi.spyOn(writer, 'enqueue')
	return () => enqueue.mock.calls.length
}

beforeEach(() => {
	vi.useFakeTimers()
	fake = installFakeChrome()
	writes = []
	for (const area of ['local', 'session'] as const) {
		const set = fake.chrome.storage[area].set
		fake.chrome.storage[area].set = async (items: Record<string, unknown>) => {
			writes.push(...Object.keys(items))
			return set(items)
		}
	}
})

afterEach(() => {
	// The test's worker stops with it, so nothing it still hears writes into the next test's storage
	stopWorker()
	vi.useRealTimers()
})

describe('autosave', () => {
	it('saves tabs opened in a session without switching away', async () => {
		const trip = await tripIsOpen()
		await openTab('https://cafe.com')
		await openTab('https://beach.com')
		await wait(QUIET_MS)
		expect(await contentOf(trip)).toEqual([...TRIP, 'https://cafe.com', 'https://beach.com'])
		expect(getLink(await lib())).toBe('linked')
		await expectStoredIndexWhole()
	})

	it('decides the link when the worker starts, without waiting for a change', async () => {
		const trip = await tripIsOpen()
		stopWorker()
		await fake.chrome.storage.session.remove(RUNTIME_KEY)
		expect(await startWorker()).toBe('unchanged')
		expect(getLink(await lib())).toBe('linked')
		expect(await contentOf(trip)).toEqual(TRIP)
	})

	it('does nothing until the library is moved in', async () => {
		await fake.seedWindow([OWN_PAGE, 'https://a.com'])
		expect(await startWorker()).toBe('not-moved-in')
		await openTab('https://b.com')
		await wait(QUIET_MS)
		expect(writes).toEqual([])
	})

	it('saves into Home when no session is open', async () => {
		await fake.seedWindow([OWN_PAGE, 'https://a.com'])
		await startWorker()
		await writer.enqueue(async (library) => {
			library.store.setValues({ schemaVersion: 3, migratedAt: 1 })
		})
		expect(await autosave.tick()).toBe('saved')
		expect(getOpenSessionId(await lib())).toBe('')
		expect(await contentOf('home')).toEqual(['https://a.com'])
	})

	it('a tick that changes nothing writes nothing to storage', async () => {
		await tripIsOpen()
		await openTab('https://cafe.com')
		await wait(QUIET_MS)
		writes = []
		expect(await autosave.tick()).toBe('unchanged')
		autosave.changed()
		await wait(MAX_WAIT_MS)
		await vi.advanceTimersByTimeAsync(100)
		expect(writes).toEqual([])
	})

	it('keeps what it replaces when more than half the saved tabs are gone', async () => {
		const trip = await tripIsOpen()
		const tabs = await chrome.tabs.query({})
		await chrome.tabs.remove(
			tabs.filter((t) => t.url !== OWN_PAGE && t.url !== TRIP[0]).map((t) => t.id!),
		)
		autosave.changed()
		await wait(QUIET_MS)
		expect(await contentOf(trip)).toEqual([TRIP[0]])
		const [kept] = listCheckpoints(await lib(), trip)
		expect(urlsOf(await getCheckpointData(await lib(), kept.id))).toEqual(TRIP)
	})

	describe('a window of tabs closed, fewer than half of the session', () => {
		const MINUTE = 60_000
		const WINDOW = Array.from({ length: 10 }, (_, i) => `https://win${i}.com`)
		const MORE = Array.from({ length: 12 }, (_, i) => `https://more${i}.com`)

		/** Trip with 15 tabs saved and a checkpoint `age` old, then a second window of 10 tabs saved */
		async function windowSaved(age: number) {
			const trip = await tripIsOpen()
			for (const url of MORE) await openTab(url)
			await wait(QUIET_MS)
			// Trip had no checkpoint, so that save kept one
			expect(listCheckpoints(await lib(), trip)).toHaveLength(1)
			await vi.advanceTimersByTimeAsync(age)
			const win = (await chrome.windows.create({ url: WINDOW[0] }))!
			for (const url of WINDOW.slice(1)) await openTab(url, win.id)
			await wait(QUIET_MS)
			expect(await contentOf(trip)).toEqual([...TRIP, ...MORE, ...WINDOW])
			// A routine save within the hour keeps no checkpoint
			expect(listCheckpoints(await lib(), trip)).toHaveLength(1)
			return { trip, windowId: win.id! }
		}
		async function closeWindow(windowId: number, count = WINDOW.length) {
			if (count === WINDOW.length) await fake.closeWindow(windowId)
			else {
				const tabs = await chrome.tabs.query({ windowId })
				await chrome.tabs.remove(tabs.slice(0, count).map((t) => t.id!))
			}
			autosave.changed()
			await wait(QUIET_MS)
		}

		it('keeps its tabs in a checkpoint when five or more are gone', async () => {
			const { trip, windowId } = await windowSaved(20 * MINUTE)
			await closeWindow(windowId)
			expect(await contentOf(trip)).toEqual([...TRIP, ...MORE])
			const [newest] = listCheckpoints(await lib(), trip)
			expect(urlsOf(await getCheckpointData(await lib(), newest.id))).toEqual([
				...TRIP,
				...MORE,
				...WINDOW,
			])
			for (const url of WINDOW) expect(await everythingKept(trip)).toContain(url)
		})

		it('makes no checkpoint when one was made in the last five minutes', async () => {
			const { trip, windowId } = await windowSaved(2 * MINUTE)
			await closeWindow(windowId)
			expect(await contentOf(trip)).toEqual([...TRIP, ...MORE])
			expect(listCheckpoints(await lib(), trip)).toHaveLength(1)
		})

		it('four tabs gone is still routine', async () => {
			const { trip, windowId } = await windowSaved(20 * MINUTE)
			await closeWindow(windowId, 4)
			expect(await contentOf(trip)).toEqual([...TRIP, ...MORE, ...WINDOW.slice(4)])
			expect(listCheckpoints(await lib(), trip)).toHaveLength(1)
		})

		it('a restarted worker decides it the same way, from what is stored', async () => {
			const { trip, windowId } = await windowSaved(20 * MINUTE)
			// Clearing the fake timers also winds the fake clock back; real time carries on
			const now = Date.now()
			stopWorker()
			vi.setSystemTime(now)
			await fake.closeWindow(windowId)
			expect(await startWorker()).toBe('saved')
			expect(listCheckpoints(await lib(), trip)).toHaveLength(2)
		})
	})
})

describe('the waits', () => {
	it('saves after 2 seconds of quiet', async () => {
		await tripIsOpen()
		writes = []
		await openTab('https://a.com')
		await wait(QUIET_MS - 100)
		await openTab('https://b.com')
		await wait(QUIET_MS - 100)
		expect(writes).toEqual([])
		await wait(100)
		expect(writes.filter((k) => k === INDEX_KEY)).toHaveLength(1)
	})

	it('saves at most 10 seconds after the first change, however busy', async () => {
		const trip = await tripIsOpen()
		writes = []
		// A tab every second for 30 seconds
		for (let i = 0; i < 30; i++) {
			await openTab(`https://busy-${i}.com`)
			await wait(1000)
		}
		await wait(QUIET_MS)
		const saves = writes.filter((k) => k === INDEX_KEY).length
		expect(saves).toBeGreaterThanOrEqual(3)
		expect(saves).toBeLessThanOrEqual(4)
		expect(await contentOf(trip)).toHaveLength(TRIP.length + 30)
	})

	it('opening and closing dozens of tabs quickly saves once', async () => {
		const trip = await tripIsOpen()
		writes = []
		for (let i = 0; i < 40; i++) {
			const tab = await chrome.tabs.create({ url: `https://quick-${i}.com`, active: false })
			autosave.changed()
			await vi.advanceTimersByTimeAsync(50)
			if (i % 2) {
				await chrome.tabs.remove(tab.id!)
				autosave.changed()
			}
		}
		await wait(QUIET_MS)
		expect(writes.filter((k) => k === INDEX_KEY)).toHaveLength(1)
		expect(writes.filter((k) => k.startsWith(VERSION_KEY_PREFIX))).toHaveLength(1)
		expect(await contentOf(trip)).toHaveLength(TRIP.length + 20)
	})

	it('a title or icon saves after 15 seconds of quiet, or with the next change', async () => {
		await tripIsOpen()
		const ticks = countTicks()
		autosave.tabUpdated({ title: 'Flights to Lisbon' })
		autosave.tabUpdated({ status: 'loading' })
		await vi.advanceTimersByTimeAsync(RETITLE_QUIET_MS - 100)
		expect(ticks()).toBe(0)
		// Another title restarts the wait
		autosave.tabUpdated({ favIconUrl: 'https://flights.com/icon.png' })
		await vi.advanceTimersByTimeAsync(RETITLE_QUIET_MS - 100)
		expect(ticks()).toBe(0)
		await vi.advanceTimersByTimeAsync(100)
		expect(ticks()).toBe(1)

		// A change that matters saves sooner, titles and all, and once
		autosave.tabUpdated({ title: 'Hotels' })
		autosave.tabUpdated({ url: 'https://flights.com/lisbon' })
		autosave.tabUpdated({ title: 'Lisbon' })
		await vi.advanceTimersByTimeAsync(QUIET_MS)
		expect(ticks()).toBe(2)
		await vi.advanceTimersByTimeAsync(RETITLE_QUIET_MS)
		expect(ticks()).toBe(2)
	})

	it('ignores changes that are not saved', async () => {
		await tripIsOpen()
		const ticks = countTicks()
		autosave.tabUpdated({ status: 'complete' })
		autosave.tabUpdated({ audible: true })
		autosave.tabUpdated({ discarded: true })
		await vi.advanceTimersByTimeAsync(RETITLE_QUIET_MS * 2)
		expect(ticks()).toBe(0)
	})
})

describe('an empty window never overwrites a session', () => {
	it('Chrome restarts and restores nothing: nothing saved, and the tabs come back on request', async () => {
		const trip = await tripIsOpen()
		await openTab('https://cafe.com')
		await wait(QUIET_MS)
		const saved = await contentOf(trip)
		const checkpoints = listCheckpoints(await lib(), trip)

		fake.restartBrowser()
		vi.clearAllTimers()
		// The worker starts before Chrome has a window
		expect(await startWorker()).toBe('no-window')
		expect(getLink(await lib())).toBe('unknown')
		await fake.seedWindow(['chrome://newtab/'])
		autosave.changed()
		await wait(QUIET_MS)
		expect(getLink(await lib())).toBe('unlinked')
		expect(await contentOf(trip)).toEqual(saved)
		// Working in the blank window saves nothing into Trip
		await openTab('https://news.com')
		await wait(QUIET_MS)
		expect(await contentOf(trip)).toEqual(saved)
		expect(listCheckpoints(await lib(), trip)).toEqual(checkpoints)

		// "Reopen its tabs"
		const result = await writer.run('reopenSaved', undefined)
		expect(result.failed).toEqual([])
		expect(openUrls()).toEqual(['chrome://newtab/', 'https://news.com', ...saved])
		autosave.changed()
		await wait(QUIET_MS)
		expect(await contentOf(trip)).toEqual(['chrome://newtab/', 'https://news.com', ...saved])
		await expectStoredIndexWhole()
	})

	it('switching away while unlinked saves the stray tabs as their own session', async () => {
		const trip = await tripIsOpen()
		fake.restartBrowser()
		await fake.seedWindow(['https://news.com'])
		await startWorker()
		const result = await writer.enqueue((library) => putAway(library))
		expect(await contentOf(trip)).toEqual(TRIP)
		const stray = getSession(await lib(), result!.savedAs!)
		expect(stray).toMatchObject({ name: 'news.com', tabCount: 1 })
		expect(getLink(await lib())).toBe('linked')
	})

	it('Chrome restores its windows late, tab by tab: links by itself, losing nothing', async () => {
		const SIX = [
			'https://1.com',
			'https://2.com',
			'https://3.com',
			'https://4.com',
			'https://5.com',
			'https://6.com',
		]
		await fake.seedWindow([OWN_PAGE, ...SIX])
		await startWorker()
		const id = await writer.enqueue(async (library) => {
			library.store.setValues({ schemaVersion: 3, migratedAt: 1 })
			const s = await createSession(library, { name: 'Six' }, tabsOf(...SIX), 1)
			await markOpen(library, s, 1)
			return s
		})

		fake.restartBrowser()
		vi.clearAllTimers()
		expect(await startWorker()).toBe('no-window')
		const windowId = await fake.seedWindow([SIX[0]])
		autosave.changed()
		await wait(QUIET_MS)
		expect(getLink(await lib())).toBe('unlinked')
		for (const url of SIX.slice(1)) {
			await openTab(url, windowId)
			await wait(QUIET_MS)
			// At every step, every saved address is still kept somewhere
			for (const saved of SIX) expect(await everythingKept(id)).toContain(saved)
		}
		expect(getLink(await lib())).toBe('linked')
		expect(await contentOf(id)).toEqual(SIX)
		await expectStoredIndexWhole()
	})

	it('the last window closes (macOS) and a blank one opens: nothing saved until they are back', async () => {
		const trip = await tripIsOpen()
		const [win] = fake.snapshot()
		await fake.closeWindow(win.id)
		autosave.changed()
		await wait(QUIET_MS)
		expect(getLink(await lib())).toBe('unknown')
		expect(await contentOf(trip)).toEqual(TRIP)

		await chrome.windows.create({})
		autosave.changed()
		await wait(QUIET_MS)
		expect(getLink(await lib())).toBe('unlinked')
		expect(await contentOf(trip)).toEqual(TRIP)

		// The person reopens the closed window: linked again by itself
		await fake.seedWindow(TRIP)
		autosave.changed()
		await wait(QUIET_MS)
		expect(getLink(await lib())).toBe('linked')
		expect(await contentOf(trip)).toEqual(['chrome://newtab/', ...TRIP])
	})

	it('the extension reloads with every tab open: linked again, and nothing written', async () => {
		const trip = await tripIsOpen()
		await openTab('https://cafe.com')
		await wait(QUIET_MS)
		fake.reloadExtension()
		vi.clearAllTimers()
		writes = []
		expect(await startWorker()).toBe('unchanged')
		expect(getLink(await lib())).toBe('linked')
		expect(writes).toEqual([RUNTIME_KEY])
		expect(await contentOf(trip)).toEqual([...TRIP, 'https://cafe.com'])
	})
})

describe('a worker Chrome stopped and started again', () => {
	it('carries on from what is stored', async () => {
		const trip = await tripIsOpen()
		await openTab('https://cafe.com')
		await wait(QUIET_MS)
		stopWorker()
		writes = []
		// A tab event wakes a new worker; storage.session still says linked
		expect(await startWorker()).toBe('unchanged')
		expect(writes).toEqual([])
		await openTab('https://beach.com')
		await wait(QUIET_MS)
		expect(await contentOf(trip)).toEqual([...TRIP, 'https://cafe.com', 'https://beach.com'])
	})

	it('stays unlinked across a restart of the worker', async () => {
		const trip = await tripIsOpen()
		fake.restartBrowser()
		await fake.seedWindow(['https://news.com'])
		expect(await startWorker()).toBe('unlinked')
		stopWorker()
		expect(await startWorker()).toBe('unlinked')
		expect(await contentOf(trip)).toEqual(TRIP)
	})
})

describe('the first save after the upgrade', () => {
	/** A schema 2 library as stored, with Work open on this device */
	function storeV2() {
		fake.storage.set(INDEX_KEY, structuredClone(sampleV2Store().getMergeableContent()))
		fake.storage.set(DEVICE_KEY, { openSessionId: 'work' })
		for (const [id, data] of Object.entries(sampleV2Entries()))
			fake.storage.set(VERSION_KEY_PREFIX + id, JSON.stringify(data))
	}

	it('takes what is open as the session, keeping its last saved state', async () => {
		storeV2()
		// A week of work since the last switch: little of the saved state is still open
		await fake.seedWindow([
			OWN_PAGE,
			'https://jira.com',
			'https://new-1.com',
			'https://new-2.com',
		])
		expect(await startWorker()).toBe('saved')
		const library = await lib()
		expect(await contentOf('work')).toEqual([
			'https://jira.com',
			'https://new-1.com',
			'https://new-2.com',
		])
		const [kept] = listCheckpoints(library, 'work')
		expect(kept).toMatchObject({ id: 'w2', reason: 'upgrade' })
		expect(urlsOf(await getCheckpointData(library, 'w2'))).toEqual([
			'https://jira.com',
			'https://docs.com',
		])
		expect(library.device.get().adoptLive).toBe(false)
		// Once: from now on the usual rules
		writes = []
		expect(await autosave.tick()).toBe('unchanged')
		expect(writes).toEqual([])
		await expectStoredIndexWhole()
	})

	it('never takes an empty window as the session', async () => {
		storeV2()
		await fake.seedWindow(['chrome://newtab/'])
		expect(await startWorker()).toBe('unlinked')
		expect(await contentOf('work')).toEqual(['https://jira.com', 'https://docs.com'])
		expect(listSessions(await lib()).find((s) => s.id === 'work')?.contentId).toBe('w2')
		expect((await lib()).device.get().adoptLive).toBe(false)
	})
})

describe('when something is wrong', () => {
	it('a tick whose index cannot be stored logs, deletes nothing, and the next one catches up', async () => {
		const trip = await tripIsOpen()
		// Its first save keeps a checkpoint; the next, within the hour, deletes what it replaces
		await openTab('https://cafe.com')
		await wait(QUIET_MS)
		const before = getSession(await lib(), trip)!.contentId
		const set = fake.chrome.storage.local.set
		let failing = true
		fake.chrome.storage.local.set = async (items: Record<string, unknown>) => {
			if (failing && INDEX_KEY in items) throw new Error('QUOTA_BYTES quota exceeded')
			return set(items)
		}
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		await openTab('https://beach.com')
		await vi.advanceTimersByTimeAsync(QUIET_MS)
		await writer.enqueue(async () => undefined).catch(() => undefined)
		expect(warn).toHaveBeenCalledWith('[papaya] autosave', expect.any(Error))
		// The stored index still points at the old content, which is still stored
		expect(fake.storage.has(VERSION_KEY_PREFIX + before)).toBe(true)
		await expectStoredIndexWhole()

		failing = false
		warn.mockRestore()
		// Nothing new to capture, but the index this worker holds is stored at last
		expect(await autosave.tick()).toBe('unchanged')
		await expectStoredIndexWhole()
		expect(fake.storage.has(VERSION_KEY_PREFIX + before)).toBe(false)
		const { createLibrary } = await import('./store')
		const stored = createLibrary()
		stored.store.setMergeableContent(fake.storage.get(INDEX_KEY) as never)
		expect(await contentOf(trip)).toEqual([...TRIP, 'https://cafe.com', 'https://beach.com'])
		expect(getSession(stored, trip)?.contentId).toBe(getSession(await lib(), trip)?.contentId)
	})

	it('an open session missing from the library heals: Home, decided by the usual rule', async () => {
		const trip = await tripIsOpen()
		await writer.enqueue(async (library) => {
			await createSession(
				library,
				{ name: 'Home', id: 'home', kind: 'home' },
				tabsOf('https://home.com'),
			)
			// Gone without this device being told (a merge, say)
			library.store.delRow('sessions', trip)
		})
		expect(await autosave.tick()).toBe('unlinked')
		const library = await lib()
		expect(getOpenSessionId(library)).toBe('')
		expect(getLink(library)).toBe('unlinked')
		// The open windows were not saved into Home
		expect(await contentOf('home')).toEqual(['https://home.com'])
		// And autosave goes on: Home's own tabs coming back link it again
		await openTab('https://home.com')
		await wait(QUIET_MS)
		expect(getLink(await lib())).toBe('linked')
	})
})
