import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import type { VersionData } from './model'
import {
	captureOpen,
	openCopy,
	parkTabs,
	putAway,
	saveCopy,
	saveOpenAs,
	saveVersion,
	switchTo,
} from './actions'
import {
	createLibrary,
	createSession,
	ensureHome,
	getOpenSessionId,
	getSession,
	getSessionData,
	listVersions,
	markOpen,
	type Library,
} from './store'

const OWN_PAGE = 'chrome-extension://papaya-test/index.html#/panel'

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

let fake: ReturnType<typeof installFakeChrome>
let lib: Library
/** Every open tab's address, all windows, in order */
const openUrls = () => fake.snapshot().flatMap((w) => w.tabs.map((t) => t.url))

beforeEach(async () => {
	fake = installFakeChrome()
	lib = createLibrary()
	markOpen(lib, ensureHome(lib))
	await fake.seedWindow([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
})

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
		expect(getSession(lib, 'home')?.status).toBe('closed')
		expect((await getSessionData(lib, 'home'))?.tabs.map((t) => t.url)).toEqual([
			'https://home-a.com',
			'https://home-b.com',
		])

		// Switching back (Undo) brings Home back as you left it, and keeps Trip's changes
		await chrome.tabs.create({ url: 'https://museum.com' })
		await switchTo(lib, 'home')
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
		expect((await getSessionData(lib, trip))?.tabs.map((t) => t.url)).toEqual([
			'https://flights.com',
			'https://hotel.com',
			'https://museum.com',
		])
		expect(listVersions(lib, trip).map((v) => v.reason)).toEqual(['switch', 'manual'])
	})

	it('never saves or closes pinned tabs', async () => {
		const [pinned] = await chrome.tabs.query({})
		const mail = await chrome.tabs.create({ url: 'https://mail.com', pinned: true })
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await switchTo(lib, trip)
		expect(openUrls()).toContain('https://mail.com')
		expect((await chrome.tabs.get(mail.id!)).pinned).toBe(true)
		expect((await getSessionData(lib, 'home'))?.tabs.map((t) => t.url)).not.toContain(
			'https://mail.com',
		)
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
		expect(listVersions(lib, 'home')).toEqual([])
	})
})

describe('saving', () => {
	it('names what is open as a new open session, leaving Home empty', async () => {
		await saveVersion(lib)
		const id = await saveOpenAs(lib, 'Research')
		expect(getSession(lib, id)).toMatchObject({ name: 'Research', status: 'open', tabCount: 2 })
		expect(getSession(lib, 'home')).toMatchObject({ status: 'closed', tabCount: 0 })
		expect(openUrls()).toEqual([OWN_PAGE, 'https://home-a.com', 'https://home-b.com'])
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

describe('putting away, copies and parking', () => {
	it('puts the open session away and goes Home', async () => {
		const id = await saveOpenAs(lib, 'Research')
		await putAway(lib)
		expect(getOpenSessionId(lib)).toBe('home')
		expect(getSession(lib, id)).toMatchObject({ status: 'closed', tabCount: 2 })
		expect(openUrls()).toEqual([OWN_PAGE, 'chrome://newtab/'])
	})

	it('opens a copy of a session without switching', async () => {
		const trip = await createSession(lib, { name: 'Trip' }, data('https://flights.com'))
		await openCopy(lib, trip)
		expect(getOpenSessionId(lib)).toBe('home')
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://home-a.com',
			'https://home-b.com',
			'https://flights.com',
		])
	})

	it('parks tabs into one Parked session that reopens them together', async () => {
		const [, a, b] = await chrome.tabs.query({})
		expect(await parkTabs(lib, [a])).toBe(1)
		expect(await parkTabs(lib, [b])).toBe(1)
		const parked = getSession(lib, 'parked')!
		expect(parked).toMatchObject({ name: 'Parked', kind: 'parked', tabCount: 2 })
		expect(openUrls()).toEqual([OWN_PAGE])
		await openCopy(lib, 'parked')
		expect(
			fake
				.snapshot()
				.at(-1)!
				.tabs.map((t) => t.url),
		).toEqual(['https://home-a.com', 'https://home-b.com'])
	})
})
