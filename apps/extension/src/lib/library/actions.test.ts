import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import type { SessionContent } from './model'
import {
	captureOpen,
	keepOpen,
	moveTabs,
	openCopy,
	putAway,
	reopenSaved,
	restoreCheckpoint,
	saveCheckpoint,
	saveCopy,
	saveOpenAs,
	startFresh,
	isAddressTitle,
	keepKnownTitles,
	switchTo,
	toVersionTab,
} from './actions'
import {
	createLibrary,
	createSession,
	ensureHome,
	getCheckpointData,
	getLink,
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

let fake: ReturnType<typeof installFakeChrome>
let lib: Library
/** Every open tab's address, all windows, in order */
const openUrls = () => fake.snapshot().flatMap((w) => w.tabs.map((t) => t.url))
const urlsOf = (d: SessionContent | null) => d?.tabs.map((t) => t.url)
async function expectOwned() {
	expect((await lib.blobs.ids()).sort()).toEqual([...referencedEntries(lib)].sort())
}

beforeEach(async () => {
	fake = installFakeChrome()
	lib = createLibrary()
	markOpen(lib, ensureHome(lib))
	await fake.seedWindow([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
})

/** Chrome came back without the open session's tabs: a fresh window, link not yet known */
async function cameBackWithout(sessionId: string, saved: string[], open: string[]) {
	await setContent(lib, sessionId, data(...saved), 'never')
	await lib.runtime.set({ link: 'unknown' })
	for (const tab of await chrome.tabs.query({})) await chrome.tabs.remove(tab.id!)
	await fake.seedWindow([OWN_PAGE, ...open])
}

describe('switchTo', () => {
	it('saves what you leave, reopens the target, and closes the old tabs', async () => {
		const trip = await createSession(
			lib,
			{ name: 'Trip' },
			data('https://flights.com', 'https://hotel.com'),
		)
		const result = await switchTo(lib, trip)
		expect(result).toEqual({ fromId: 'home', toId: trip, failed: [] })
		expect(openUrls()).toEqual([OWN_PAGE, 'https://flights.com', 'https://hotel.com'])
		expect(getOpenSessionId(lib)).toBe(trip)
		expect(getLink(lib)).toBe('linked')
		expect(getSession(lib, 'home')?.status).toBe('closed')
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])

		// Switching back (Undo) brings Home back as you left it, and keeps Trip's changes
		await chrome.tabs.create({ url: 'https://museum.com' })
		await switchTo(lib, 'home')
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
		expect(urlsOf(await getSessionData(lib, trip))).toEqual([
			'https://flights.com',
			'https://hotel.com',
			'https://museum.com',
		])
		// What it replaced is kept: its first checkpoint
		expect(listCheckpoints(lib, trip).map((c) => c.reason)).toEqual(['switch'])
		await expectOwned()
	})

	it('never saves or closes pinned tabs', async () => {
		const [pinned] = await chrome.tabs.query({})
		const mail = await chrome.tabs.create({ url: 'https://mail.com', pinned: true })
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await switchTo(lib, trip)
		expect(openUrls()).toContain('https://mail.com')
		expect((await chrome.tabs.get(mail.id!)).pinned).toBe(true)
		expect(urlsOf(await getSessionData(lib, 'home'))).not.toContain('https://mail.com')
		expect(pinned).toBeDefined()
	})

	it('keeps a window open when switching to an empty session', async () => {
		const empty = await createSession(lib, { name: 'Fresh start' })
		await switchTo(lib, empty)
		expect(openUrls()).toEqual([OWN_PAGE, 'chrome://newtab/'])
	})

	it('does nothing to the browser if the target is gone', async () => {
		await expect(switchTo(lib, 'nope')).rejects.toThrow(/no longer exists/)
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
		expect(listCheckpoints(lib, 'home')).toEqual([])
	})

	it('unlinked: leaves the session as it was and saves the open tabs as a new one first', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await cameBackWithout(
			'home',
			['https://home-a.com', 'https://home-b.com'],
			['https://news.com', 'https://news.com/2', 'https://mail.com'],
		)
		const result = await switchTo(lib, trip)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		expect(listCheckpoints(lib, 'home')).toEqual([])
		const saved = getSession(lib, result!.savedAs!)
		expect(saved).toMatchObject({ name: 'news.com, mail.com', status: 'closed', tabCount: 3 })
		expect(openUrls()).toEqual([OWN_PAGE, 'https://flights.com'])
		expect(getLink(lib)).toBe('linked')
		await expectOwned()
	})

	it('unlinked: names the open tabs it saves from their sites, not from blank tabs', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await cameBackWithout(
			'home',
			['https://home-a.com'],
			['chrome://newtab/', 'https://news.com', 'chrome://newtab/', 'https://mail.com'],
		)
		const result = await switchTo(lib, trip)
		expect(getSession(lib, result!.savedAs!)?.name).toBe('news.com, mail.com')
	})

	it('unlinked with only blank tabs open: nothing to save first', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await cameBackWithout('home', ['https://home-a.com'], ['chrome://newtab/'])
		const result = await switchTo(lib, trip)
		expect(result?.savedAs).toBeUndefined()
		expect(listSessions(lib)).toHaveLength(2)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual(['https://home-a.com'])
	})

	it('right after the upgrade, saves what is open into the session left, keeping what it had', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await setContent(lib, 'home', data('https://last-saved-long-ago.com'), 'never')
		await lib.device.set({ adoptLive: true })
		await switchTo(lib, trip)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		const [kept] = listCheckpoints(lib, 'home')
		expect(kept.reason).toBe('upgrade')
		expect(urlsOf(await getCheckpointData(lib, kept.id))).toEqual([
			'https://last-saved-long-ago.com',
		])
		expect(lib.device.get().adoptLive).toBe(false)
	})
})

describe('saving', () => {
	it('names what is open as a new open session, leaving Home empty', async () => {
		await saveCheckpoint(lib)
		const id = await saveOpenAs(lib, 'Research')
		expect(getSession(lib, id)).toMatchObject({ name: 'Research', status: 'open', tabCount: 2 })
		expect(getSession(lib, 'home')).toMatchObject({
			status: 'closed',
			tabCount: 0,
			contentId: '',
		})
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
		expect(getLink(lib)).toBe('linked')
		await expectOwned()
	})

	it('unlinked: naming what is open leaves the session being left exactly as it is', async () => {
		await cameBackWithout(
			'home',
			['https://home-a.com', 'https://home-b.com'],
			['https://news.com'],
		)
		const before = structuredClone(lib.store.getRow('sessions', 'home'))
		const id = await saveOpenAs(lib, 'Reading')
		expect(lib.store.getRow('sessions', 'home')).toEqual(before)
		expect(urlsOf(await getSessionData(lib, id))).toEqual(['https://news.com'])
		expect(getOpenSessionId(lib)).toBe(id)
		expect(getLink(lib)).toBe('linked')
	})

	it('saves a copy without changing anything', async () => {
		const id = await saveCopy(lib)
		expect(getSession(lib, id)).toMatchObject({
			name: 'home-a.com, home-b.com',
			status: 'closed',
			tabCount: 2,
		})
		expect(getOpenSessionId(lib)).toBe('home')
		expect(openUrls()).toHaveLength(3)
	})

	it('names a copy from its sites, not from blank tabs', async () => {
		await fake.seedWindow(['chrome://newtab/', 'about:blank', 'chrome://newtab/'])
		const id = await saveCopy(lib)
		expect(getSession(lib, id)).toMatchObject({ name: 'home-a.com, home-b.com', tabCount: 5 })
	})

	it('tells a title Chrome made from the address (an unloaded tab) from a real one', () => {
		// As Chrome 148 reported them for tabs it had not loaded after a restart
		expect(
			isAddressTitle(
				'obs.papaya.test:8765/✓-unicode',
				'http://obs.papaya.test:8765/%E2%9C%93-unicode',
			),
		).toBe(true)
		expect(isAddressTitle('obs.papaya.test:8765', 'http://obs.papaya.test:8765/')).toBe(true)
		expect(
			isAddressTitle('ctrl.papaya.test:8765/open', 'http://ctrl.papaya.test:8765/open'),
		).toBe(true)
		expect(
			isAddressTitle(
				'data:text/html,<title>D</title>hi',
				'data:text/html,<title>D</title>hi',
			),
		).toBe(true)
		expect(isAddressTitle('', 'https://a.com/x')).toBe(true)
		expect(isAddressTitle('https://a.com/x', 'https://a.com/x')).toBe(true)
		expect(isAddressTitle('a.com/x', 'https://a.com/x')).toBe(true)
		expect(isAddressTitle('a.com/x', 'https://me:pw@a.com/x')).toBe(true)
		expect(
			isAddressTitle(
				'Real title of obs.papaya.test/plain',
				'http://obs.papaya.test:8765/plain',
			),
		).toBe(false)
		expect(isAddressTitle('a.com', 'https://a.com/x')).toBe(false)
		expect(isAddressTitle('x', 'https://a.com/%E0%A4%A')).toBe(false)
	})

	it('keeps saved titles and icons for tabs that show none of their own, and nothing else', () => {
		const tab = (url: string, title: string, favIconUrl = '') => ({
			url,
			title,
			favIconUrl,
			windowId: 1,
			groupId: -1,
			active: false,
		})
		const saved = {
			...data(),
			tabs: [
				tab('https://a.com/', 'A', 'a.png'),
				tab('https://dup.com/x', 'First', 'd1.png'),
				tab('https://dup.com/x', 'Second', 'd2.png'),
				tab('https://b.com/y', 'b.com/y'),
				tab('https://gone.com/', 'Gone'),
			],
		}
		const capture = {
			...data(),
			tabs: [
				tab('https://new.com/', 'new.com'),
				tab('https://a.com/', 'a.com'),
				tab('https://dup.com/x', 'dup.com/x'),
				tab('https://dup.com/x', ''),
				tab('https://dup.com/x', 'dup.com/x'),
				tab('https://b.com/y', 'b.com/y', 'b.png'),
				tab('https://a.com/', 'Renamed', ''),
			],
		}
		const kept = keepKnownTitles(saved, capture)
		expect(kept.tabs.map((t) => [t.url, t.title, t.favIconUrl])).toEqual([
			['https://new.com/', 'new.com', ''],
			['https://a.com/', 'A', 'a.png'],
			['https://dup.com/x', 'First', 'd1.png'],
			['https://dup.com/x', 'Second', 'd2.png'],
			// A third copy takes the last saved one's
			['https://dup.com/x', 'Second', 'd2.png'],
			// Nothing better saved: as captured
			['https://b.com/y', 'b.com/y', 'b.png'],
			// A title of its own stays; only the missing icon is filled
			['https://a.com/', 'Renamed', 'a.png'],
		])
		expect(kept.groups).toBe(capture.groups)
		expect(kept.windows).toBe(capture.windows)
		// Nothing to fill: the capture itself
		const plain = { ...data(), tabs: [tab('https://z.com/', 'Z', 'z.png')] }
		expect(keepKnownTitles(saved, plain)).toBe(plain)
	})

	it('a tab still loading at a blank address is saved at the address it is going to', () => {
		const tab = (url: string, pendingUrl?: string) =>
			({ id: 1, windowId: 1, url, pendingUrl }) as chrome.tabs.Tab
		expect(toVersionTab(tab('about:blank', 'https://news.com')).url).toBe('https://news.com')
		expect(toVersionTab(tab('', 'https://news.com')).url).toBe('https://news.com')
		expect(toVersionTab(tab('chrome://newtab/', 'https://news.com')).url).toBe(
			'https://news.com',
		)
		expect(toVersionTab(tab('https://a.com', 'https://b.com')).url).toBe('https://a.com')
		expect(toVersionTab(tab('about:blank', 'chrome://newtab/')).url).toBe('about:blank')
		expect(toVersionTab(tab('about:blank')).url).toBe('about:blank')
	})

	it('a checkpoint by hand saves what is open first, then keeps a copy of it', async () => {
		const id = await saveCheckpoint(lib)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		expect(listCheckpoints(lib, 'home').map((c) => [c.id, c.reason])).toEqual([[id, 'manual']])
		expect(urlsOf(await getCheckpointData(lib, id!))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		await expectOwned()
	})

	it('unlinked, a checkpoint by hand keeps the saved tabs and never saves what is open', async () => {
		await cameBackWithout('home', ['https://home-a.com'], ['https://news.com'])
		const id = await saveCheckpoint(lib)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual(['https://home-a.com'])
		expect(urlsOf(await getCheckpointData(lib, id!))).toEqual(['https://home-a.com'])
		expect(getLink(lib)).toBe('unlinked')
	})

	it('captures groups and windows, never Papaya pages', async () => {
		const tabs = await chrome.tabs.query({})
		const groupId = await chrome.tabs.group({ tabIds: [tabs[1].id!, tabs[2].id!] })
		await chrome.tabGroups.update(groupId, { title: 'Docs', color: 'blue' })
		const capture = await captureOpen()
		expect(capture.tabs.map((t) => [t.url, t.groupId])).toEqual([
			['https://home-a.com', groupId],
			['https://home-b.com', groupId],
		])
		expect(capture.groups).toEqual([
			expect.objectContaining({ id: groupId, title: 'Docs', color: 'blue' }),
		])
		expect(capture.windows).toHaveLength(1)
	})
})

describe('putting away and copies', () => {
	it('puts the open session away and goes Home', async () => {
		const id = await saveOpenAs(lib, 'Research')
		await putAway(lib)
		expect(getOpenSessionId(lib)).toBe('home')
		expect(getSession(lib, id)).toMatchObject({ status: 'closed', tabCount: 2 })
		expect(openUrls()).toEqual([OWN_PAGE, 'chrome://newtab/'])
	})

	it('starts fresh from Home: what was open is a new closed session, Home is open and empty', async () => {
		const pinned = await chrome.tabs.create({ url: 'https://mail.com', pinned: true })
		const { id, failed } = await startFresh(lib)
		expect(failed).toEqual([])
		expect(getSession(lib, id)).toMatchObject({
			name: 'home-a.com, home-b.com',
			status: 'closed',
			tabCount: 2,
		})
		expect(urlsOf(await getSessionData(lib, id))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		expect(getOpenSessionId(lib)).toBe('home')
		expect(getSession(lib, 'home')).toMatchObject({ status: 'open', tabCount: 0 })
		expect(openUrls()).toEqual([OWN_PAGE, 'https://mail.com', 'chrome://newtab/'])
		expect((await chrome.tabs.get(pinned.id!)).pinned).toBe(true)
		expect(getLink(lib)).toBe('linked')
		await expectOwned()
	})

	it('starts fresh under the name given', async () => {
		const { id } = await startFresh(lib, '  Reading list ')
		expect(getSession(lib, id)?.name).toBe('Reading list')
	})

	it('opens a copy of a session, or of a checkpoint, without switching', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await setContent(lib, trip, data('https://hotel.com'), 'always')
		await openCopy(lib, trip)
		await openCopy(lib, trip, listCheckpoints(lib, trip)[0].id)
		expect(getOpenSessionId(lib)).toBe('home')
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://home-a.com',
			'https://home-b.com',
			'https://hotel.com',
			'https://flights.com',
		])
	})
})

describe('restoring a checkpoint', () => {
	it('of a closed session: only the library changes', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await setContent(lib, trip, data('https://hotel.com'), 'always')
		const [checkpoint] = listCheckpoints(lib, trip)
		const result = await restoreCheckpoint(lib, trip, checkpoint.id)
		expect(result).toEqual({ reopened: false, failed: [] })
		expect(urlsOf(await getSessionData(lib, trip))).toEqual(['https://flights.com'])
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
		await expectOwned()
	})

	it('of the open session: its windows go back to it, and what was open is kept', async () => {
		await setContent(lib, 'home', data('https://monday.com'), 'never', { now: 1 })
		await setContent(lib, 'home', data('https://home-a.com', 'https://home-b.com'), 'always', {
			now: 2,
		})
		await lib.runtime.set({ link: 'linked' })
		await chrome.tabs.create({ url: 'https://tuesday.com' })
		const monday = listCheckpoints(lib, 'home')[0]

		const result = await restoreCheckpoint(lib, 'home', monday.id)
		expect(result.reopened).toBe(true)
		expect(openUrls()).toEqual([OWN_PAGE, 'https://monday.com'])
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual(['https://monday.com'])
		const checkpoints = listCheckpoints(lib, 'home')
		expect(checkpoints[0].reason).toBe('restore')
		expect(urlsOf(await getCheckpointData(lib, checkpoints[0].id))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
			'https://tuesday.com',
		])
		// The restored checkpoint stays (after the one the save of what was open made)
		expect(checkpoints.map((c) => c.reason)).toEqual(['restore', 'switch', 'autosave'])
		expect(checkpoints.map((c) => c.id)).toContain(monday.id)
		expect(getLink(lib)).toBe('linked')
		await expectOwned()
	})
})

describe('settling an unlinked session', () => {
	it('"Reopen its tabs" opens the saved tabs next to what is open and links', async () => {
		await cameBackWithout(
			'home',
			['https://home-a.com', 'https://home-b.com'],
			['https://news.com'],
		)
		const result = await reopenSaved(lib)
		expect(result.failed).toEqual([])
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://news.com',
			'https://home-a.com',
			'https://home-b.com',
		])
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		expect(getLink(lib)).toBe('linked')
	})

	it('"Keep what\'s open" saves it as the content, keeping what it had', async () => {
		await cameBackWithout(
			'home',
			['https://home-a.com', 'https://home-b.com'],
			['https://news.com'],
		)
		await keepOpen(lib)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual(['https://news.com'])
		const [kept] = listCheckpoints(lib, 'home')
		expect(kept.reason).toBe('keep-open')
		expect(urlsOf(await getCheckpointData(lib, kept.id))).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])
		expect(getLink(lib)).toBe('linked')
		await expectOwned()
	})
})

describe('keeping what is open', () => {
	it('refuses blank tabs alone over a session with tabs', async () => {
		await cameBackWithout('home', ['https://home-a.com'], ['chrome://newtab/'])
		await expect(keepOpen(lib)).rejects.toThrow(/No tabs are open/)
		expect(urlsOf(await getSessionData(lib, 'home'))).toEqual(['https://home-a.com'])
		expect(getLink(lib)).toBe('unknown')
	})
})

describe('moving tabs', () => {
	it('into a closed session ten at a time keeps its history', async () => {
		const urls = Array.from({ length: 10 }, (_, i) => `https://read-${i}.com`)
		await fake.seedWindow(urls)
		const later = await createSession(lib, { name: 'Read later' }, data('https://v1.com'), 1)
		await setContent(lib, later, data('https://v1.com', 'https://v2.com'), 'always', {
			now: 2,
		})
		const history = listCheckpoints(lib, later).map((c) => c.id)

		for (const url of urls) {
			const tab = (await chrome.tabs.query({})).find((t) => t.url === url)!
			await moveTabs(lib, [tab.id!], { sessionId: later })
		}
		// The checkpoint from before is still there, and the moves added at most one
		const checkpoints = listCheckpoints(lib, later)
		expect(checkpoints.map((c) => c.id)).toEqual(expect.arrayContaining(history))
		expect(checkpoints.length).toBeLessThanOrEqual(history.length + 1)
		expect(checkpoints[0].reason).toBe('moved')
		expect((await getSessionData(lib, later))?.tabs).toHaveLength(12)
		expect(openUrls().filter((url) => url.startsWith('https://read-'))).toEqual([])
		await expectOwned()
	})

	it('into a new session by name', async () => {
		const [, tab] = await chrome.tabs.query({})
		const id = await moveTabs(lib, [tab.id!], { name: 'Elsewhere' })
		expect(urlsOf(await getSessionData(lib, id))).toEqual(['https://home-a.com'])
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-b.com'])
	})
})
