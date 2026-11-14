import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { saveOpenAs, switchTo } from './actions'
import { exportLibrary, importLibrary } from './backup'
import { openStashed, stashGroup, stashGroups, swapToGroup, swapToStashed } from './stash'
import {
	addStashed,
	createLibrary,
	createSession,
	deleteSession,
	ensureHome,
	getOpenSessionId,
	getStashedTabs,
	listStashed,
	markOpen,
	type Library,
} from './store'

const OWN_PAGE = 'chrome-extension://papaya-test/index.html#/panel'

let fake: ReturnType<typeof installFakeChrome>
let lib: Library
let windowId: number

/** Group some of the seeded tabs (by address) as Chrome would */
async function group(title: string, color: string, ...urls: string[]) {
	const ids = (await chrome.tabs.query({})).filter((t) => urls.includes(t.url!)).map((t) => t.id!)
	const groupId = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] })
	await chrome.tabGroups.update(groupId, { title, color: color as chrome.tabGroups.Color })
	return groupId
}
const openUrls = () => fake.snapshot().flatMap((w) => w.tabs.map((t) => t.url))
const groupOf = (url: string) =>
	fake
		.snapshot()
		.flatMap((w) => w.tabs)
		.find((t) => t.url === url)?.group

beforeEach(async () => {
	fake = installFakeChrome()
	lib = createLibrary()
	markOpen(lib, ensureHome(lib))
	windowId = await fake.seedWindow([
		OWN_PAGE,
		'https://docs-a.com',
		'https://docs-b.com',
		'https://jira.com/1',
		'https://jira.com/2',
		'https://loose.com',
	])
})

describe('stashGroup', () => {
	it('keeps the group in the open session and closes its tabs', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const result = await stashGroup(lib, docs)
		expect(result.name).toBe('Docs')
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://jira.com/1',
			'https://jira.com/2',
			'https://loose.com',
		])
		expect(listStashed(lib, 'home')).toEqual([
			expect.objectContaining({
				id: result.stashId,
				name: 'Docs',
				color: 'blue',
				tabCount: 2,
			}),
		])
		expect((await getStashedTabs(lib, result.stashId)).map((t) => t.url)).toEqual([
			'https://docs-a.com',
			'https://docs-b.com',
		])
	})

	it('keeps the window open when a group was all it had', async () => {
		const other = await fake.seedWindow(['https://solo-a.com', 'https://solo-b.com'])
		const solo = await group('Solo', 'red', 'https://solo-a.com', 'https://solo-b.com')
		await stashGroup(lib, solo)
		const win = fake.snapshot().find((w) => w.id === other)
		expect(win?.tabs.map((t) => t.url)).toEqual(['chrome://newtab/'])
	})

	it('stashes several groups and keeps the rest open', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		const results = await stashGroups(lib, [docs, jira, 999])
		expect(results.map((r) => r.name)).toEqual(['Docs', 'Jira'])
		expect(openUrls()).toEqual([OWN_PAGE, 'https://loose.com'])
	})
})

describe('openStashed', () => {
	it('reopens the group focused, unloaded except its first tab, and unstashes it', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		const { stashId } = await stashGroup(lib, docs)
		const result = await openStashed(lib, stashId, windowId)
		expect(result.failed).toEqual([])
		expect(openUrls().slice(-2)).toEqual(['https://docs-a.com', 'https://docs-b.com'])
		expect(groupOf('https://docs-a.com')).toBe('Docs/blue/false')
		// Focused: its first tab is showing and the other group is folded
		expect(fake.snapshot()[0].tabs.find((t) => t.active)?.url).toBe('https://docs-a.com')
		expect(groupOf('https://jira.com/1')).toBe('Jira/green/true')
		expect(fake.discardedUrls()).toEqual(['https://docs-b.com'])
		expect(listStashed(lib)).toEqual([])
		expect(await lib.blobs.ids()).toEqual([])
		expect(jira).toBeDefined()
	})

	it('skips tabs Chrome refuses, and keeps the stash when none open', async () => {
		fake = installFakeChrome({ blockedUrls: ['chrome://kill'] })
		lib = createLibrary()
		markOpen(lib, ensureHome(lib))
		windowId = await fake.seedWindow([OWN_PAGE])
		const tab = (url: string) => ({
			url,
			title: '',
			favIconUrl: '',
			windowId: 0,
			groupId: -1,
			active: false,
		})
		const mixed = await addStashed(lib, 'home', { name: 'Mixed', color: 'cyan' }, [
			tab('chrome://kill'),
			tab('https://ok.com'),
		])
		const partial = await openStashed(lib, mixed, windowId)
		expect(partial.failed).toEqual(['chrome://kill'])
		expect(groupOf('https://ok.com')).toBe('Mixed/cyan/false')

		const bad = await addStashed(lib, 'home', { name: 'Bad', color: 'red' }, [
			tab('chrome://kill'),
		])
		await expect(openStashed(lib, bad, windowId)).rejects.toThrow(/wouldn't reopen/)
		expect(listStashed(lib).map((g) => g.name)).toEqual(['Bad'])
	})
	it('waits for each tab to commit its address before unloading it', async () => {
		fake = installFakeChrome({ commitDelayMs: 250 })
		lib = createLibrary()
		markOpen(lib, ensureHome(lib))
		windowId = await fake.seedWindow([OWN_PAGE])
		const tab = (url: string) => ({
			url,
			title: '',
			favIconUrl: '',
			windowId: 0,
			groupId: -1,
			active: false,
		})
		const id = await addStashed(lib, 'home', { name: 'Slow', color: 'blue' }, [
			tab('https://a.com'),
			tab('https://b.com'),
			tab('https://c.com'),
		])
		await openStashed(lib, id, windowId)
		expect(fake.discardedUrls()).toEqual(['https://b.com', 'https://c.com'])
	})
})

describe('swapping', () => {
	it('swaps to a stashed group: opens it and stashes the one you were in', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		const { stashId } = await stashGroup(lib, docs)
		await chrome.tabs.update((await chrome.tabs.query({ groupId: jira }))[0].id!, {
			active: true,
		})
		const { stashed } = await swapToStashed(lib, stashId, windowId)
		expect(stashed?.name).toBe('Jira')
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://loose.com',
			'https://docs-a.com',
			'https://docs-b.com',
		])
		expect(listStashed(lib).map((g) => g.name)).toEqual(['Jira'])
	})

	it('swaps to an open group: focuses it and stashes the one you were in', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		await chrome.tabs.update((await chrome.tabs.query({ groupId: docs }))[0].id!, {
			active: true,
		})
		const { stashed } = await swapToGroup(lib, jira)
		expect(stashed?.name).toBe('Docs')
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://jira.com/1',
			'https://jira.com/2',
			'https://loose.com',
		])
		// From a loose tab there's nothing to stash
		await chrome.tabs.update(
			(await chrome.tabs.query({})).find((t) => t.url === 'https://loose.com')!.id!,
			{
				active: true,
			},
		)
		expect((await swapToGroup(lib, jira)).stashed).toBeNull()
	})
})

describe('stashed groups and sessions', () => {
	it('belong to their session: they go away and come back with it', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		await stashGroup(lib, docs)
		const trip = await createSession(
			lib,
			{ name: 'Trip' },
			{
				tabs: [
					{
						url: 'https://flights.com',
						title: '',
						favIconUrl: '',
						windowId: 1,
						groupId: -1,
						active: false,
					},
				],
				groups: [],
				windows: [],
			},
		)
		await switchTo(lib, trip)
		expect(getOpenSessionId(lib)).toBe(trip)
		expect(listStashed(lib, trip)).toEqual([])
		expect(listStashed(lib, 'home').map((g) => g.name)).toEqual(['Docs'])
		await switchTo(lib, 'home')
		expect(listStashed(lib, getOpenSessionId(lib)).map((g) => g.name)).toEqual(['Docs'])
	})

	it('move with Home into a session you name', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		await stashGroup(lib, docs)
		const id = await saveOpenAs(lib, 'Research')
		expect(listStashed(lib, 'home')).toEqual([])
		expect(listStashed(lib, id).map((g) => g.name)).toEqual(['Docs'])
	})

	it('are deleted with their session and carried by backups', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const { stashId } = await stashGroup(lib, docs)
		const backup = JSON.parse(JSON.stringify(await exportLibrary(lib)))
		const restored = createLibrary()
		await importLibrary(restored, backup, 'replace')
		expect((await getStashedTabs(restored, stashId)).map((t) => t.url)).toEqual([
			'https://docs-a.com',
			'https://docs-b.com',
		])
		await deleteSession(lib, 'home')
		expect(listStashed(lib)).toEqual([])
		expect(await lib.blobs.ids()).toEqual([])
	})
})
