import { describe, expect, it } from 'vitest'
import { buildOpenGroups, groupInPlace, nextGroupId, pickColors, ungroupTabs } from './tabGroups'

const group = (id: number, windowId = 1, title = `G${id}`) => ({
	id,
	title,
	color: 'blue' as chrome.tabGroups.Color,
	collapsed: false,
	windowId,
})
const tab = (id: number, index: number, groupId = -1, windowId = 1, active = false) => ({
	id,
	index,
	groupId,
	windowId,
	active,
})

describe('buildOpenGroups', () => {
	it('collects tab ids, first index and the active tab per group', () => {
		const groups = buildOpenGroups(
			[group(10), group(20)],
			[tab(1, 0), tab(2, 1, 20), tab(3, 2, 20, 1, true), tab(4, 3, 10), tab(5, 4, 10)],
		)
		expect(groups).toEqual([
			expect.objectContaining({ id: 20, tabIds: [2, 3], firstIndex: 1, hasActiveTab: true }),
			expect.objectContaining({ id: 10, tabIds: [4, 5], firstIndex: 3, hasActiveTab: false }),
		])
	})

	it('orders by window, then by position in the tab strip', () => {
		const groups = buildOpenGroups(
			[group(1, 2), group(2, 1), group(3, 1)],
			[tab(1, 0, 1, 2), tab(2, 5, 2, 1), tab(3, 0, 3, 1)],
		)
		expect(groups.map((g) => g.id)).toEqual([3, 2, 1])
	})

	it('drops groups with no tabs and defaults a missing title', () => {
		const groups = buildOpenGroups(
			[{ ...group(1), title: undefined }, group(2)],
			[tab(1, 0, 1)],
		)
		expect(groups).toHaveLength(1)
		expect(groups[0].title).toBe('')
	})
})

describe('nextGroupId', () => {
	const groups = [
		{ id: 7, firstIndex: 10 },
		{ id: 5, firstIndex: 0 },
		{ id: 9, firstIndex: 4 },
	]

	it('moves in tab-strip order', () => {
		expect(nextGroupId(groups, 5, 1)).toBe(9)
		expect(nextGroupId(groups, 9, -1)).toBe(5)
	})

	it('wraps around at both ends', () => {
		expect(nextGroupId(groups, 7, 1)).toBe(5)
		expect(nextGroupId(groups, 5, -1)).toBe(7)
	})

	it('starts at the first or last group from a loose tab', () => {
		expect(nextGroupId(groups, null, 1)).toBe(5)
		expect(nextGroupId(groups, null, -1)).toBe(7)
	})

	it('returns null when there are no groups', () => {
		expect(nextGroupId([], null, 1)).toBeNull()
	})
})

describe('pickColors', () => {
	it('skips colors already used and never picks grey', () => {
		expect(pickColors(3, ['blue', 'green'])).toEqual(['yellow', 'red', 'purple'])
	})

	it('cycles when more groups than colors are needed', () => {
		const colors = pickColors(10)
		expect(colors).toHaveLength(10)
		expect(colors).not.toContain('grey')
		expect(colors[8]).toBe(colors[0])
	})

	it('falls back to the full palette when every color is taken', () => {
		const all = ['blue', 'green', 'yellow', 'red', 'purple', 'cyan', 'orange', 'pink']
		expect(pickColors(2, all)).toEqual(['blue', 'green'])
	})
})

interface FakeTab {
	id: number
	windowId: number
	groupId: number
	pinned: boolean
	active: boolean
	url: string
}

/**
 * A fake tab strip: windows hold ordered tabs. New groups land at the start of the
 * window (`at: 'start'`) or the end, never where Chrome would put them, so undo must
 * restore the order from recorded positions alone.
 */
function fakeStrip(layout: Record<number, number[]>, at: 'start' | 'end') {
	const tabs = new Map<number, FakeTab>()
	const order = new Map<number, number[]>()
	for (const [windowId, ids] of Object.entries(layout)) {
		order.set(Number(windowId), [...ids])
		for (const id of ids) {
			tabs.set(id, {
				id,
				windowId: Number(windowId),
				groupId: -1,
				pinned: false,
				active: false,
				url: `https://example.com/${id}`,
			})
		}
	}
	let nextGroup = 100
	const remove = (ids: number[]) => {
		for (const [windowId, list] of order)
			order.set(
				windowId,
				list.filter((id) => !ids.includes(id)),
			)
	}
	const snapshot = () =>
		[...order].flatMap(([, list]) => list.map((id, index) => ({ ...tabs.get(id)!, index })))

	Object.assign(globalThis, {
		chrome: {
			runtime: { id: 'papaya' },
			tabs: {
				query: async () => snapshot(),
				group: async ({
					tabIds,
					createProperties,
				}: {
					tabIds: number[]
					createProperties: { windowId: number }
				}) => {
					const groupId = nextGroup++
					remove(tabIds)
					const list = order.get(createProperties.windowId)!
					if (at === 'start') list.unshift(...tabIds)
					else list.push(...tabIds)
					for (const id of tabIds) tabs.get(id)!.groupId = groupId
					return groupId
				},
				ungroup: async (ids: number[]) => ids.forEach((id) => (tabs.get(id)!.groupId = -1)),
				move: async (
					ids: number | number[],
					{ windowId, index }: { windowId: number; index: number },
				) => {
					const list = Array.isArray(ids) ? ids : [ids]
					remove(list)
					const target = order.get(windowId)!
					target.splice(index === -1 ? target.length : index, 0, ...list)
				},
			},
			tabGroups: { update: async () => ({}) },
		},
	})
	return {
		tabs,
		order: (windowId: number) => order.get(windowId),
		close: (id: number) => {
			remove([id])
			tabs.delete(id)
		},
	}
}

describe('groupInPlace and ungroupTabs', () => {
	const plans = [
		{ name: 'A', color: 'blue', tabIds: [2, 5, 7, 10] },
		{ name: 'B', color: 'red', tabIds: [3, 8, 5] },
	]

	it('groups per window, never steals a tab twice, and skips pinned or grouped tabs', async () => {
		const strip = fakeStrip({ 1: [1, 2, 3, 4, 5, 6, 7, 8], 2: [9, 10, 11] }, 'end')
		strip.tabs.get(7)!.pinned = true
		strip.tabs.get(8)!.groupId = 55
		const result = await groupInPlace(plans)
		// A splits into window 1 (2, 5) and window 2 (10); B keeps only 3
		expect(result.groupIds).toHaveLength(3)
		expect(result.tabIds).toEqual([2, 5, 10, 3])
		expect(strip.tabs.get(5)!.groupId).toBe(strip.tabs.get(2)!.groupId)
	})

	for (const at of ['start', 'end'] as const) {
		it(`undo restores the original order (groups placed at the ${at})`, async () => {
			const strip = fakeStrip({ 1: [1, 2, 3, 4, 5, 6, 7, 8], 2: [9, 10, 11, 12] }, at)
			const result = await groupInPlace(plans)
			expect(strip.order(1)).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8])
			await ungroupTabs(result.tabIds, result.positions)
			expect(strip.order(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
			expect(strip.order(2)).toEqual([9, 10, 11, 12])
			expect([...strip.tabs.values()].every((tab) => tab.groupId === -1)).toBe(true)
		})
	}

	it('undo still works when a grouped tab was closed in between', async () => {
		const strip = fakeStrip({ 1: [1, 2, 3, 4, 5, 6, 7, 8] }, 'start')
		const result = await groupInPlace(plans)
		strip.close(5)
		await ungroupTabs(result.tabIds, result.positions)
		expect(strip.order(1)).toEqual([1, 2, 3, 4, 6, 7, 8])
	})
})
