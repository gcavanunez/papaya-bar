import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_PARK_DAYS, getCloseableTabIds, isParkable } from './liveTabs'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000
const OWN = 'chrome-extension://papaya/index.html'

let liveTabs: Partial<chrome.tabs.Tab>[] = []

beforeEach(() => {
	liveTabs = []
	Object.assign(globalThis, {
		chrome: { runtime: { id: 'papaya' }, tabs: { query: async () => liveTabs } },
	})
})

const tab = (overrides: Partial<chrome.tabs.Tab> = {}) =>
	({
		id: 1,
		url: 'https://example.com',
		pinned: false,
		active: false,
		lastAccessed: NOW - 8 * DAY,
		...overrides,
	}) as chrome.tabs.Tab

describe('isParkable', () => {
	it('parks tabs untouched for the threshold', () => {
		expect(isParkable(tab(), AUTO_PARK_DAYS, NOW)).toBe(true)
		expect(isParkable(tab({ lastAccessed: NOW - 6 * DAY }), AUTO_PARK_DAYS, NOW)).toBe(false)
		expect(isParkable(tab({ lastAccessed: NOW - 4 * DAY }), 3, NOW)).toBe(true)
	})

	it('never parks pinned, active, or Papaya tabs', () => {
		expect(isParkable(tab({ pinned: true }), AUTO_PARK_DAYS, NOW)).toBe(false)
		expect(isParkable(tab({ active: true }), AUTO_PARK_DAYS, NOW)).toBe(false)
		expect(isParkable(tab({ url: OWN }), AUTO_PARK_DAYS, NOW)).toBe(false)
	})

	it('treats a tab with no last-access time as fresh', () => {
		expect(isParkable(tab({ lastAccessed: undefined }), AUTO_PARK_DAYS, NOW)).toBe(false)
	})
})

describe('getCloseableTabIds', () => {
	it('leaves out pinned tabs and Papaya pages', async () => {
		liveTabs = [
			tab({ id: 1 }),
			tab({ id: 2, pinned: true }),
			tab({ id: 3, url: OWN }),
			tab({ id: 4 }),
		]
		expect(await getCloseableTabIds()).toEqual([1, 4])
	})
})
