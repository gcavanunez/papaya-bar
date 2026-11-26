import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { openCopy } from './actions'
import { saveGroupAsSession, saveGroupsAsSessions, undoSaveGroup } from './groups'
import { isOneGroup, type SessionContent } from './model'
import {
	createLibrary,
	createSession,
	ensureHome,
	getOpenSessionId,
	getSession,
	getSessionData,
	markOpen,
	referencedEntries,
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

/** A session that is one group, as saving a group makes */
function groupContent(name: string, color: string, ...urls: string[]): SessionContent {
	return {
		tabs: urls.map((url) => ({
			url,
			title: url,
			favIconUrl: '',
			windowId: 1,
			groupId: 7,
			active: false,
		})),
		groups: [{ id: 7, title: name, color, collapsed: false, windowId: 1 }],
		windows: [{ id: 1 }],
	}
}
async function expectOwned() {
	expect((await lib.blobs.ids()).sort()).toEqual([...referencedEntries(lib)].sort())
}

beforeEach(async () => {
	fake = installFakeChrome()
	lib = createLibrary()
	await markOpen(lib, ensureHome(lib))
	windowId = await fake.seedWindow([
		OWN_PAGE,
		'https://docs-a.com',
		'https://docs-b.com',
		'https://jira.com/1',
		'https://jira.com/2',
		'https://loose.com',
	])
})

describe('saving a group as a session', () => {
	it('makes a closed session named and colored after the group, holding just it, and closes its tabs', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const saved = await saveGroupAsSession(lib, docs)
		expect(saved).toMatchObject({ name: 'Docs', windowId })
		expect(getSession(lib, saved.sessionId)).toMatchObject({
			name: 'Docs',
			color: 'blue',
			status: 'closed',
			tabCount: 2,
		})
		const content = (await getSessionData(lib, saved.sessionId))!
		expect(isOneGroup(content)).toBe(true)
		expect(content.groups[0]).toMatchObject({ title: 'Docs', color: 'blue' })
		expect(content.tabs.map((t) => t.url)).toEqual(['https://docs-a.com', 'https://docs-b.com'])
		expect(openUrls()).toEqual([
			OWN_PAGE,
			'https://jira.com/1',
			'https://jira.com/2',
			'https://loose.com',
		])
		// The session you're in stays the open one
		expect(getOpenSessionId(lib)).toBe('home')
		await expectOwned()
	})

	it('names an unnamed group, and keeps the window open when the group was all it had', async () => {
		const other = await fake.seedWindow(['https://solo-a.com', 'https://solo-b.com'])
		const solo = await group('', 'red', 'https://solo-a.com', 'https://solo-b.com')
		const saved = await saveGroupAsSession(lib, solo)
		expect(saved.name).toBe('Unnamed group')
		const win = fake.snapshot().find((w) => w.id === other)
		expect(win?.tabs.map((t) => t.url)).toEqual(['chrome://newtab/'])
	})

	it("leaves Papaya's own pages open, and refuses a group of only those", async () => {
		const docs = await group('Docs', 'blue', OWN_PAGE, 'https://docs-a.com')
		const saved = await saveGroupAsSession(lib, docs)
		expect((await getSessionData(lib, saved.sessionId))?.tabs.map((t) => t.url)).toEqual([
			'https://docs-a.com',
		])
		expect(openUrls()).toContain(OWN_PAGE)
		await expect(saveGroupAsSession(lib, docs)).rejects.toThrow(/no tabs to save/)
	})

	it('saves several groups, each its own session, and skips one that fails', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		const saved = await saveGroupsAsSessions(lib, [docs, jira, 999])
		expect(saved.map((s) => s.name)).toEqual(['Docs', 'Jira'])
		expect(openUrls()).toEqual([OWN_PAGE, 'https://loose.com'])
	})

	it('undo reopens the group where it was and deletes the session', async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		const saved = await saveGroupAsSession(lib, docs)
		const result = await undoSaveGroup(lib, saved.sessionId, saved.windowId)
		expect(result.failed).toEqual([])
		expect(openUrls().slice(-2)).toEqual(['https://docs-a.com', 'https://docs-b.com'])
		expect(groupOf('https://docs-a.com')).toBe('Docs/blue/false')
		expect(getSession(lib, saved.sessionId)).toBeNull()
		expect(await lib.blobs.ids()).toEqual([])
		expect(jira).toBeDefined()
	})

	it("won't undo once the session is the open one", async () => {
		const docs = await group('Docs', 'blue', 'https://docs-a.com', 'https://docs-b.com')
		const saved = await saveGroupAsSession(lib, docs)
		await markOpen(lib, saved.sessionId)
		await expect(undoSaveGroup(lib, saved.sessionId, windowId)).rejects.toThrow(/open session/)
		expect(getSession(lib, saved.sessionId)).not.toBeNull()
	})
})

describe('opening a copy of a session that is one group', () => {
	it('adds the group to the window, focused, unloaded except its first tab; the session stays', async () => {
		const jira = await group('Jira', 'green', 'https://jira.com/1', 'https://jira.com/2')
		const id = await createSession(
			lib,
			{ name: 'Docs' },
			groupContent('Docs', 'blue', 'https://a.com', 'https://b.com', 'https://c.com'),
		)
		const result = await openCopy(lib, id, undefined, windowId)
		expect(result?.windowIds).toEqual([windowId])
		expect(fake.snapshot()).toHaveLength(1)
		expect(openUrls().slice(-3)).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
		expect(groupOf('https://a.com')).toBe('Docs/blue/false')
		// Focused: its first tab is showing and the other group is folded
		expect(fake.snapshot()[0].tabs.find((t) => t.active)?.url).toBe('https://a.com')
		expect(groupOf('https://jira.com/1')).toBe('Jira/green/true')
		expect(fake.discardedUrls()).toEqual(['https://b.com', 'https://c.com'])
		expect(getSession(lib, id)).not.toBeNull()
		expect(jira).toBeDefined()
	})

	it('skips tabs Chrome refuses, and fails when it opens none', async () => {
		fake = installFakeChrome({ blockedUrls: ['chrome://kill'] })
		lib = createLibrary()
		windowId = await fake.seedWindow([OWN_PAGE])
		const mixed = await createSession(
			lib,
			{ name: 'Mixed' },
			groupContent('Mixed', 'cyan', 'chrome://kill', 'https://ok.com'),
		)
		expect((await openCopy(lib, mixed, undefined, windowId))?.failed).toEqual(['chrome://kill'])
		expect(groupOf('https://ok.com')).toBe('Mixed/cyan/false')
		const bad = await createSession(
			lib,
			{ name: 'Bad' },
			groupContent('Bad', 'red', 'chrome://kill'),
		)
		await expect(openCopy(lib, bad, undefined, windowId)).rejects.toThrow(/wouldn't reopen/)
	})

	it('waits for each tab to commit its address before unloading it', async () => {
		fake = installFakeChrome({ commitDelayMs: 250 })
		lib = createLibrary()
		windowId = await fake.seedWindow([OWN_PAGE])
		const id = await createSession(
			lib,
			{ name: 'Slow' },
			groupContent('Slow', 'blue', 'https://a.com', 'https://b.com', 'https://c.com'),
		)
		await openCopy(lib, id, undefined, windowId)
		expect(fake.discardedUrls()).toEqual(['https://b.com', 'https://c.com'])
	})
})
