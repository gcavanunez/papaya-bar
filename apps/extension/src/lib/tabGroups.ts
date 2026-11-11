/**
 * tabGroups — Chrome tab groups as Papaya's "open groups".
 *
 * Framework-free (`chrome.*` only) so the side panel, the ⌘K palette and the
 * background worker (website palette, keyboard commands) all share it.
 */

export const GROUP_COLORS = [
	'blue',
	'green',
	'yellow',
	'red',
	'purple',
	'cyan',
	'orange',
	'pink',
	'grey',
] as const
export type GroupColor = (typeof GROUP_COLORS)[number]

export interface OpenGroup {
	id: number
	title: string
	color: string
	collapsed: boolean
	windowId: number
	tabIds: number[]
	/** Position of the group's first tab in its window, for tab-strip order */
	firstIndex: number
	/** The window's active tab is in this group */
	hasActiveTab: boolean
}

export interface GroupPlan {
	name: string
	color?: string
	tabIds: number[]
}

export interface TabPosition {
	id: number
	windowId: number
	index: number
}

export interface GroupedResult {
	groupIds: number[]
	tabIds: number[]
	/** Where the grouped tabs were before, for undo */
	positions: TabPosition[]
}

type ChromeTab = chrome.tabs.Tab

const NO_GROUP = -1

function isOwnPage(tab: ChromeTab): boolean {
	const prefix = `chrome-extension://${chrome.runtime.id}`
	return (tab.url || '').startsWith(prefix) || (tab.pendingUrl || '').startsWith(prefix)
}

/** Open tabs that aren't in a group and can be grouped (pinned tabs can't). */
export function isLooseTab(tab: ChromeTab): boolean {
	return (
		(tab.groupId ?? NO_GROUP) === NO_GROUP && !tab.pinned && !isOwnPage(tab) && tab.id != null
	)
}

// ==================== Pure helpers ====================

/** Build the open-group list from raw Chrome data, in window then tab-strip order. */
export function buildOpenGroups(
	groups: Pick<chrome.tabGroups.TabGroup, 'id' | 'title' | 'color' | 'collapsed' | 'windowId'>[],
	tabs: Pick<ChromeTab, 'id' | 'groupId' | 'index' | 'active' | 'windowId'>[],
): OpenGroup[] {
	const byGroup = new Map<
		number,
		{ tabIds: number[]; firstIndex: number; hasActiveTab: boolean }
	>()
	for (const tab of tabs) {
		const groupId = tab.groupId ?? NO_GROUP
		if (groupId === NO_GROUP || tab.id == null) continue
		const entry = byGroup.get(groupId) ?? {
			tabIds: [],
			firstIndex: Number.MAX_SAFE_INTEGER,
			hasActiveTab: false,
		}
		entry.tabIds.push(tab.id)
		entry.firstIndex = Math.min(entry.firstIndex, tab.index)
		entry.hasActiveTab ||= tab.active
		byGroup.set(groupId, entry)
	}
	return groups
		.filter((group) => byGroup.has(group.id))
		.map((group) => ({
			id: group.id,
			title: group.title ?? '',
			color: group.color,
			collapsed: group.collapsed,
			windowId: group.windowId,
			...byGroup.get(group.id)!,
		}))
		.sort((a, b) => a.windowId - b.windowId || a.firstIndex - b.firstIndex)
}

/**
 * The group to focus next in one window. From a loose tab, forward goes to the first
 * group and backward to the last; the ends wrap around.
 */
export function nextGroupId(
	groups: Pick<OpenGroup, 'id' | 'firstIndex'>[],
	currentGroupId: number | null,
	direction: 1 | -1,
): number | null {
	if (!groups.length) return null
	const ordered = [...groups].sort((a, b) => a.firstIndex - b.firstIndex)
	const current = ordered.findIndex((group) => group.id === currentGroupId)
	if (current === -1) return direction === 1 ? ordered[0].id : ordered[ordered.length - 1].id
	return ordered[(current + direction + ordered.length) % ordered.length].id
}

/** Colors for new groups, skipping ones already used in the window where possible. */
export function pickColors(count: number, used: Iterable<string> = []): GroupColor[] {
	const taken = new Set(used)
	const fresh = GROUP_COLORS.filter((color) => color !== 'grey' && !taken.has(color))
	const pool = fresh.length ? fresh : GROUP_COLORS.filter((color) => color !== 'grey')
	return Array.from({ length: count }, (_, i) => pool[i % pool.length])
}

// ==================== Chrome operations ====================

export async function listOpenGroups(): Promise<OpenGroup[]> {
	const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})])
	return buildOpenGroups(groups, tabs)
}

// Only normal windows can hold tab groups
export async function listLooseTabs(): Promise<ChromeTab[]> {
	return (await chrome.tabs.query({ windowType: 'normal' })).filter(isLooseTab)
}

/**
 * Focus a group: expand it, activate its most recently used tab, and fold up the
 * other groups in the same window. Nothing closes.
 */
export async function focusGroup(groupId: number): Promise<void> {
	const tabs = await chrome.tabs.query({ groupId })
	if (!tabs.length) return
	const target =
		tabs.find((tab) => tab.active) ??
		[...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]
	const { windowId } = target

	await chrome.tabGroups.update(groupId, { collapsed: false })
	if (target.id != null) await chrome.tabs.update(target.id, { active: true })
	await chrome.windows.update(windowId, { focused: true })

	// Collapse after activating, so Chrome never has to move away from a folded active tab
	const others = await chrome.tabGroups.query({ windowId, collapsed: false })
	await Promise.all(
		others
			.filter((group) => group.id !== groupId)
			.map((group) => chrome.tabGroups.update(group.id, { collapsed: true })),
	)
}

/** Focus the next or previous group in a window (the last focused one by default). */
export async function cycleGroup(direction: 1 | -1, windowId?: number): Promise<number | null> {
	const window = windowId ?? (await chrome.windows.getLastFocused()).id
	if (window == null) return null
	const [groups, tabs] = await Promise.all([
		chrome.tabGroups.query({ windowId: window }),
		chrome.tabs.query({ windowId: window }),
	])
	const open = buildOpenGroups(groups, tabs)
	const activeGroup = tabs.find((tab) => tab.active)?.groupId ?? NO_GROUP
	const next = nextGroupId(open, activeGroup === NO_GROUP ? null : activeGroup, direction)
	if (next != null) await focusGroup(next)
	return next
}

/**
 * Turn suggestions into Chrome tab groups. A suggestion spanning several windows
 * becomes one group in the window that holds most of its tabs; the strays move there.
 * Tabs that closed, got pinned or were grouped since the suggestion are skipped, and
 * a group that fails doesn't stop the rest. New groups start collapsed unless they
 * hold the window's active tab. Returns what was grouped, and where those tabs were,
 * for undo (grouping pulls a group's tabs together, and strays change window).
 */
export async function groupInPlace(plans: GroupPlan[]): Promise<GroupedResult> {
	const live = new Map(
		(await chrome.tabs.query({ windowType: 'normal' })).map((tab) => [tab.id, tab]),
	)
	const before = new Map(live)
	const groupIds: number[] = []
	const tabIds: number[] = []

	for (const plan of plans) {
		const byWindow = new Map<number, ChromeTab[]>()
		for (const id of plan.tabIds) {
			const tab = live.get(id)
			if (!tab || !isLooseTab(tab)) continue
			const list = byWindow.get(tab.windowId) ?? []
			list.push(tab)
			byWindow.set(tab.windowId, list)
		}
		if (!byWindow.size) continue
		// The window with most of the group's tabs (the earliest, on a tie) keeps them all
		const [windowId] = [...byWindow].sort((a, b) => b[1].length - a[1].length)[0]
		const windowTabs = [...byWindow.get(windowId)!]
		const strays = [...byWindow].filter(([id]) => id !== windowId).flatMap(([, tabs]) => tabs)
		try {
			if (strays.length) {
				await chrome.tabs.move(
					strays.map((tab) => tab.id as number),
					{ windowId, index: -1 },
				)
				windowTabs.push(...strays)
			}
		} catch (error) {
			console.warn('[papaya] could not move tabs into one window', error)
		}
		const ids = windowTabs.map((tab) => tab.id as number)
		let groupId: number
		try {
			groupId = await chrome.tabs.group({
				tabIds: ids as [number, ...number[]],
				createProperties: { windowId },
			})
		} catch (error) {
			console.warn('[papaya] could not group tabs', error)
			continue
		}
		// Mark these tabs as used so a later suggestion can't steal them
		for (const tab of windowTabs) live.set(tab.id, { ...tab, windowId, groupId })
		groupIds.push(groupId)
		tabIds.push(...ids)
		await chrome.tabGroups
			.update(groupId, {
				title: plan.name,
				color: (plan.color ?? 'grey') as chrome.tabGroups.Color,
				collapsed: !windowTabs.some((tab) => tab.active),
			})
			.catch((error) => console.warn('[papaya] could not name group', error))
	}
	const positions = tabIds.map((id) => {
		const tab = before.get(id) as ChromeTab
		return { id, windowId: tab.windowId, index: tab.index }
	})
	return { groupIds, tabIds, positions }
}

/**
 * Undo for groupInPlace: ungroup whichever of these tabs still exist and put them back
 * where they were, moving strays back to their own window if it's still open. They go
 * to the end of their window first, then each drops into its old slot in order, which
 * restores the order whatever grouping did to it.
 */
export async function ungroupTabs(tabIds: number[], positions: TabPosition[] = []): Promise<void> {
	const tabs = await chrome.tabs.query({})
	const existing = new Map(tabs.map((tab) => [tab.id, tab]))
	const ids = tabIds.filter((id) => existing.has(id))
	if (!ids.length) return
	await chrome.tabs.ungroup(ids as [number, ...number[]])

	// A window whose only tabs were moved out has closed; its strays stay where they are
	const openWindows = new Set(tabs.map((tab) => tab.windowId))
	const byWindow = new Map<number, TabPosition[]>()
	for (const position of positions) {
		if (!existing.has(position.id) || !openWindows.has(position.windowId)) continue
		const list = byWindow.get(position.windowId) ?? []
		list.push(position)
		byWindow.set(position.windowId, list)
	}
	// Every tab back to its own window first, so no stray still shifts another window's slots
	for (const [windowId, list] of byWindow) {
		list.sort((a, b) => a.index - b.index)
		await chrome.tabs.move(
			list.map((p) => p.id),
			{ windowId, index: -1 },
		)
	}
	for (const [windowId, list] of byWindow) {
		for (const { id, index } of list) await chrome.tabs.move(id, { windowId, index })
	}
}
