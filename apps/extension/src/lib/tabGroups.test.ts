import { describe, expect, it } from 'vitest'
import {
	buildOpenGroups,
	groupInPlace,
	nextGroupId,
	pickColors,
	regroupInPlace,
	undoRegroup,
	ungroupTabs,
} from './tabGroups'

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
	const groupProps = new Map<
		number,
		{ title: string; color: string; collapsed: boolean; windowId: number }
	>()
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
					groupId: existing,
					createProperties,
				}: {
					tabIds: number[]
					groupId?: number
					createProperties?: { windowId: number }
				}) => {
					if (existing != null) {
						// Joining tabs land next to the group: ones left of it before it, the rest after
						const windowId = groupProps.get(existing)!.windowId
						const inWindow = () => order.get(windowId)!
						const joining = tabIds.filter((id) => tabs.get(id)!.groupId !== existing)
						const members = inWindow().filter(
							(id) => tabs.get(id)!.groupId === existing,
						)
						const start = inWindow().indexOf(members[0])
						const left = joining.filter((id) => {
							const index = inWindow().indexOf(id)
							return index !== -1 && index < start
						})
						const right = joining.filter((id) => !left.includes(id))
						remove(joining)
						const pos = inWindow().indexOf(members[0])
						inWindow().splice(pos + members.length, 0, ...right)
						inWindow().splice(pos, 0, ...left)
						for (const id of joining) {
							tabs.get(id)!.groupId = existing
							tabs.get(id)!.windowId = windowId
						}
						return existing
					}
					if (!createProperties) throw new Error('fake: pass createProperties.windowId')
					const groupId = nextGroup++
					groupProps.set(groupId, {
						title: '',
						color: 'grey',
						collapsed: false,
						windowId: createProperties.windowId,
					})
					remove(tabIds)
					const list = order.get(createProperties.windowId)!
					if (at === 'start') list.unshift(...tabIds)
					else list.push(...tabIds)
					for (const id of tabIds) {
						tabs.get(id)!.groupId = groupId
						tabs.get(id)!.windowId = createProperties.windowId
					}
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
					for (const id of list) tabs.get(id)!.windowId = windowId
				},
			},
			tabGroups: {
				get: async (id: number) => {
					const group = groupProps.get(id)
					// Like Chrome, a group is gone once its last tab leaves
					const hasTabs = [...tabs.values()].some((tab) => tab.groupId === id)
					if (!group || !hasTabs) throw new Error(`No group with id: ${id}.`)
					return { id, ...group }
				},
				update: async (id: number, props: object) => {
					Object.assign(groupProps.get(id) ?? {}, props)
					return {}
				},
				move: async (id: number, { index }: { index: number }) => {
					const windowId = groupProps.get(id)!.windowId
					const members = order
						.get(windowId)!
						.filter((tabId) => tabs.get(tabId)!.groupId === id)
					remove(members)
					// remove() replaces the window's list, so read it again
					const list = order.get(windowId)!
					list.splice(index === -1 ? list.length : index, 0, ...members)
					return {}
				},
			},
		},
	})
	return {
		tabs,
		order: (windowId: number) => order.get(windowId),
		close: (id: number) => {
			remove([id])
			tabs.delete(id)
		},
		/** An existing group, its tabs already next to each other */
		addGroup: (
			id: number,
			tabIds: number[],
			props: { title: string; color: string; collapsed: boolean },
		) => {
			const windowId = tabs.get(tabIds[0])!.windowId
			groupProps.set(id, { ...props, windowId })
			for (const tabId of tabIds) tabs.get(tabId)!.groupId = id
		},
		/** Each group in a window, as its title and tabs in strip order */
		groupsIn: (windowId: number) => {
			const out: { title: string; color: string; collapsed: boolean; tabs: number[] }[] = []
			for (const id of order.get(windowId)!) {
				const groupId = tabs.get(id)!.groupId
				if (groupId === -1) continue
				const props = groupProps.get(groupId)!
				const last = out.at(-1)
				if (last && last.title === props.title && last.color === props.color)
					last.tabs.push(id)
				else
					out.push({
						title: props.title,
						color: props.color,
						collapsed: props.collapsed,
						tabs: [id],
					})
			}
			return out
		},
	}
}

describe('groupInPlace and ungroupTabs', () => {
	const plans = [
		{ name: 'A', color: 'blue', tabIds: [2, 5, 7, 10] },
		{ name: 'B', color: 'red', tabIds: [3, 8, 5] },
	]

	it('never steals a tab twice, and skips pinned or grouped tabs', async () => {
		const strip = fakeStrip({ 1: [1, 2, 3, 4, 5, 6, 7, 8], 2: [9, 10, 11] }, 'end')
		strip.tabs.get(7)!.pinned = true
		strip.tabs.get(8)!.groupId = 55
		const result = await groupInPlace(plans)
		// A is 2 and 5 (window 1) plus 10 (window 2); B keeps only 3
		expect(result.groupIds).toHaveLength(2)
		expect(result.tabIds).toEqual([2, 5, 10, 3])
		expect(strip.tabs.get(5)!.groupId).toBe(strip.tabs.get(2)!.groupId)
	})

	it('moves strays into the window holding most of the group', async () => {
		const strip = fakeStrip({ 1: [1, 2, 3, 4], 2: [5, 6, 7] }, 'end')
		const result = await groupInPlace([{ name: 'AI', tabIds: [6, 2, 3] }])
		expect(result.groupIds).toHaveLength(1)
		expect(strip.order(1)).toEqual([1, 4, 2, 3, 6])
		expect(strip.order(2)).toEqual([5, 7])
		expect(new Set([2, 3, 6].map((id) => strip.tabs.get(id)!.groupId)).size).toBe(1)
		await ungroupTabs(result.tabIds, result.positions)
		expect(strip.order(1)).toEqual([1, 2, 3, 4])
		expect(strip.order(2)).toEqual([5, 6, 7])
	})

	it('leaves strays where they are on undo if their window has closed', async () => {
		const strip = fakeStrip({ 1: [1, 2], 2: [3] }, 'end')
		const result = await groupInPlace([{ name: 'All', tabIds: [1, 2, 3] }])
		expect(strip.order(2)).toEqual([])
		await ungroupTabs(result.tabIds, result.positions)
		expect(strip.order(1)).toEqual([1, 2, 3])
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

describe('regroupInPlace and undoRegroup', () => {
	/** Window 1: Old (1, 2) and Other (4, 5) are groups, 3 and 6 are loose; window 2: 7, 8 */
	function grouped(at: 'start' | 'end') {
		const strip = fakeStrip({ 1: [1, 2, 3, 4, 5, 6], 2: [7, 8] }, at)
		strip.addGroup(50, [1, 2], { title: 'Old', color: 'red', collapsed: true })
		strip.addGroup(51, [4, 5], { title: 'Other', color: 'blue', collapsed: false })
		return strip
	}
	const allTabs = [1, 2, 3, 4, 5, 6, 7, 8]
	const fresh = [
		{ name: 'Mixed', color: 'green', tabIds: [2, 4, 6] },
		{ name: 'Across', color: 'yellow', tabIds: [1, 7, 8] },
	]

	it('takes tabs out of their groups, then groups them afresh; the rest end up loose', async () => {
		const strip = grouped('end')
		const result = await regroupInPlace(fresh, allTabs)
		const groupOf = (id: number) => strip.tabs.get(id)!.groupId
		expect(groupOf(2)).toBe(groupOf(4))
		expect(groupOf(4)).toBe(groupOf(6))
		// Across has two tabs in window 2, so tab 1 moves there
		expect(strip.tabs.get(1)!.windowId).toBe(2)
		expect(groupOf(1)).toBe(groupOf(7))
		// Tabs 3 and 5 fit no new group: loose, their old group gone
		expect(groupOf(3)).toBe(-1)
		expect(groupOf(5)).toBe(-1)
		expect(result.involved.sort()).toEqual(allTabs)
		expect(result.previous).toEqual([
			{ id: 50, title: 'Old', color: 'red', collapsed: true, windowId: 1, tabIds: [1, 2] },
			{
				id: 51,
				title: 'Other',
				color: 'blue',
				collapsed: false,
				windowId: 1,
				tabIds: [4, 5],
			},
		])
	})

	for (const at of ['start', 'end'] as const) {
		it(`undo brings back the old groups and order (new groups placed at the ${at})`, async () => {
			const strip = grouped(at)
			const result = await regroupInPlace(fresh, allTabs)
			await undoRegroup(result)
			expect(strip.order(1)).toEqual([1, 2, 3, 4, 5, 6])
			expect(strip.order(2)).toEqual([7, 8])
			expect(strip.groupsIn(1)).toEqual([
				{ title: 'Old', color: 'red', collapsed: true, tabs: [1, 2] },
				{ title: 'Other', color: 'blue', collapsed: false, tabs: [4, 5] },
			])
			expect(strip.groupsIn(2)).toEqual([])
		})
	}

	it('leaves pinned tabs and their groups alone', async () => {
		const strip = grouped('end')
		strip.tabs.get(6)!.pinned = true
		const result = await regroupInPlace(fresh, allTabs)
		expect(result.involved).not.toContain(6)
		expect(strip.tabs.get(6)!.groupId).toBe(-1)
	})

	for (const at of ['start', 'end'] as const) {
		it(`takes only some of a group's tabs, and undo puts them back in it (new groups at the ${at})`, async () => {
			const strip = grouped(at)
			// A selection: tab 1 of Old, loose 3, tab 4 of Other
			const result = await regroupInPlace(
				[{ name: 'New', color: 'green', tabIds: [1, 3, 4] }],
				[1, 3, 4],
			)
			expect(strip.tabs.get(2)!.groupId).toBe(50)
			expect(strip.tabs.get(5)!.groupId).toBe(51)
			expect(strip.tabs.get(1)!.groupId).toBe(strip.tabs.get(4)!.groupId)
			await undoRegroup(result)
			expect(strip.order(1)).toEqual([1, 2, 3, 4, 5, 6])
			// Back in the very same groups, not copies of them
			expect([1, 2, 3, 4, 5, 6].map((id) => strip.tabs.get(id)!.groupId)).toEqual([
				50, 50, -1, 51, 51, -1,
			])
		})
	}

	it('undo skips a tab closed in between', async () => {
		const strip = grouped('start')
		const result = await regroupInPlace(fresh, allTabs)
		strip.close(2)
		await undoRegroup(result)
		expect(strip.order(1)).toEqual([1, 3, 4, 5, 6])
		expect(strip.groupsIn(1)).toEqual([
			{ title: 'Old', color: 'red', collapsed: true, tabs: [1] },
			{ title: 'Other', color: 'blue', collapsed: false, tabs: [4, 5] },
		])
	})
})
