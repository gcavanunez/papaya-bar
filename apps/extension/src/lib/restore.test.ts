import { describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { placeWindow, restoreSnapshot, type Snapshot } from './restore'

const LAPTOP = { left: 0, top: 0, width: 1728, height: 1117 }
const MONITOR = { left: 1728, top: -200, width: 2560, height: 1440 }

describe('placeWindow', () => {
	it('keeps a window that is on a connected display', () => {
		expect(placeWindow({ left: 100, top: 50, width: 1200, height: 800 }, [LAPTOP])).toEqual({
			left: 100,
			top: 50,
			width: 1200,
			height: 800,
		})
	})

	it('picks the display the window is mostly on and shrinks it to fit', () => {
		expect(
			placeWindow({ left: 1800, top: -100, width: 3000, height: 900 }, [LAPTOP, MONITOR]),
		).toEqual({
			left: 1728,
			top: -100,
			width: 2560,
			height: 900,
		})
	})

	it('moves a window from a display that is gone onto the primary display', () => {
		expect(placeWindow({ left: 4000, top: 0, width: 1400, height: 900 }, [LAPTOP])).toEqual({
			left: 164,
			top: 0,
			width: 1400,
			height: 900,
		})
	})

	it('lets Chrome decide when there are no saved bounds', () => {
		expect(placeWindow(undefined, [LAPTOP])).toEqual({})
		expect(placeWindow({ id: 0, width: 0, height: 0 }, [LAPTOP])).toEqual({})
	})
})

describe('restoreSnapshot', () => {
	it('restores windows in order, with groups and the active tab, even when addresses repeat', async () => {
		const fake = installFakeChrome()
		const snapshot: Snapshot = {
			windows: [
				{ id: 11, left: 0, top: 0, width: 1200, height: 800 },
				{ id: 22, left: 100, top: 100, width: 900, height: 700 },
			],
			groups: [
				{ id: 5, title: 'Docs', color: 'blue', collapsed: true },
				{ id: 6, title: 'Repo', color: 'green', collapsed: false },
			],
			tabs: [
				{ url: 'https://a.com', windowId: 11, groupId: -1 },
				{ url: 'https://same.com', windowId: 11, groupId: 5 },
				{ url: 'https://same.com', windowId: 11, groupId: 6 },
				{ url: 'https://b.com', windowId: 11, groupId: 6, active: true },
				{ url: 'https://c.com', windowId: 22, groupId: -1 },
				{ url: 'https://d.com', windowId: 22, groupId: 5 },
			],
		}
		const result = await restoreSnapshot(snapshot)
		expect(result.failed).toEqual([])
		expect(result.tabIds).toHaveLength(6)
		expect(fake.snapshot()).toEqual([
			{
				id: result.windowIds[0],
				bounds: { left: 0, top: 0, width: 1200, height: 800 },
				tabs: [
					{ url: 'https://a.com', active: false, group: null },
					{ url: 'https://same.com', active: false, group: 'Docs/blue/true' },
					{ url: 'https://same.com', active: false, group: 'Repo/green/false' },
					{ url: 'https://b.com', active: true, group: 'Repo/green/false' },
				],
			},
			{
				id: result.windowIds[1],
				bounds: { left: 100, top: 100, width: 900, height: 700 },
				tabs: [
					{ url: 'https://c.com', active: true, group: null },
					{ url: 'https://d.com', active: false, group: 'Docs/blue/true' },
				],
			},
		])
	})

	it('reopens tabs saved without a window (Parked) in one window', async () => {
		const fake = installFakeChrome()
		await restoreSnapshot({
			windows: [{ id: 0, width: 1200, height: 800, left: 0, top: 0 }],
			groups: [],
			tabs: [
				{ url: 'https://old-1.com', windowId: 0 },
				{ url: 'https://old-2.com', windowId: 0 },
				{ url: 'https://old-3.com' },
			],
		})
		const windows = fake.snapshot()
		expect(windows).toHaveLength(1)
		expect(windows[0].tabs.map((t) => t.url)).toEqual([
			'https://old-1.com',
			'https://old-2.com',
			'https://old-3.com',
		])
	})

	it('skips tabs Chrome refuses to open and keeps the rest', async () => {
		const fake = installFakeChrome({ blockedUrls: ['chrome://kill', 'file:///secret'] })
		const result = await restoreSnapshot({
			windows: [],
			groups: [{ id: 1, title: 'G', color: 'red' }],
			tabs: [
				{ url: 'chrome://kill', windowId: 1 },
				{ url: 'https://a.com', windowId: 1, groupId: 1 },
				{ url: 'file:///secret', windowId: 1, groupId: 1 },
				{ url: 'https://b.com', windowId: 1, groupId: 1 },
			],
		})
		expect(result.failed.sort()).toEqual(['chrome://kill', 'file:///secret'])
		const [win] = fake.snapshot()
		// The blank tab Chrome opened in place of the refused first one is closed
		expect(win.tabs.map((t) => [t.url, t.group])).toEqual([
			['https://a.com', 'G/red/false'],
			['https://b.com', 'G/red/false'],
		])
	})

	it('leaves tabs ungrouped when their group details were never saved', async () => {
		const fake = installFakeChrome()
		await restoreSnapshot({
			windows: [],
			groups: [],
			tabs: [
				{ url: 'https://a.com', windowId: 1, groupId: 77 },
				{ url: 'https://b.com', windowId: 1, groupId: 77 },
			],
		})
		expect(fake.snapshot()[0].tabs.every((t) => t.group === null)).toBe(true)
	})

	it('keeps a collapsed group open when it holds the active tab', async () => {
		const fake = installFakeChrome()
		await restoreSnapshot({
			windows: [],
			groups: [{ id: 3, title: 'Now', color: 'cyan', collapsed: true }],
			tabs: [
				{ url: 'https://a.com', windowId: 1 },
				{ url: 'https://b.com', windowId: 1, groupId: 3, active: true },
			],
		})
		expect(fake.snapshot()[0].tabs[1]).toEqual({
			url: 'https://b.com',
			active: true,
			group: 'Now/cyan/false',
		})
	})
})
