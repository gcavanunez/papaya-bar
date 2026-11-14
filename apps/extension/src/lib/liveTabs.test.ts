import { beforeEach, describe, expect, it } from 'vitest'
import { getCloseableTabIds } from './liveTabs'

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
