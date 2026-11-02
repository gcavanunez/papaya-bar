/**
 * swapEngine — framework-free browser operations for the context swap loop.
 *
 * Pure `chrome.*` + logic, no Vue, so it can run in BOTH extension pages and the
 * background service worker (which powers the global content-script palette).
 *
 * - captureLiveData / getCloseableTabIds: read the current browser state
 * - restoreContext: recreate windows/tabs/groups (ported from the original openAll)
 */
import type { Group, SaveableTab } from '@/types'
import type { SavedWindow, SavedDisplay } from '@/hooks/useSessionsData'
import type { SavedGroup } from '@/sync/store'

type ChromeTab = chrome.tabs.Tab

export interface CaptureData {
	tabs: SaveableTab[]
	groups: SavedGroup[] | Group[]
	windows: SavedWindow[]
}

export interface RestoreData extends CaptureData {
	displays?: SavedDisplay[]
}

// ==================== Capture helpers ====================

export function extPrefix(): string {
	return `chrome-extension://${chrome.runtime.id}`
}

/** True for the extension's own pages (manager / side panel) — never closed/saved. */
export function isOwnPage(tab: ChromeTab): boolean {
	const prefix = extPrefix()
	return (tab.url || '').startsWith(prefix) || (tab.pendingUrl || '').startsWith(prefix)
}

export function mapToSaveable(tab: ChromeTab): SaveableTab {
	return {
		id: tab.id,
		stableId: `stableId-${tab.id}`,
		url: tab.url,
		title: tab.title,
		favIconUrl: tab.favIconUrl,
		windowId: tab.windowId,
		groupId: tab.groupId,
		active: tab.active,
	}
}

export async function queryLiveTabs(): Promise<SaveableTab[]> {
	const tabs = await chrome.tabs.query({})
	return tabs.filter((t) => !isOwnPage(t)).map(mapToSaveable)
}

/** IDs of tabs a swap is allowed to close (not extension pages, not pinned). */
export async function getCloseableTabIds(): Promise<number[]> {
	const tabs = await chrome.tabs.query({})
	return tabs.filter((t) => t.id != null && !isOwnPage(t) && !t.pinned).map((t) => t.id as number)
}

/**
 * Capture the current browser state. Pass `tabsInput` to capture a subset
 * (peel-off) while still recording the live window layout.
 */
export async function captureLiveData(tabsInput?: SaveableTab[]): Promise<CaptureData> {
	const [allWindows, groups] = await Promise.all([
		chrome.windows.getAll(),
		chrome.tabGroups.query({}),
	])
	const tabs = tabsInput ?? (await queryLiveTabs())
	const windows = allWindows.map((w) => ({
		id: w.id,
		width: w.width,
		left: w.left,
		height: w.height,
		top: w.top,
	}))
	return { tabs, groups, windows }
}

// ==================== Restore (ported from openAll) ====================

function areRectanglesOverlap(rect1: number[], rect2: number[]) {
	const [left1, top1, right1, bottom1] = [rect1[0], rect1[1], rect1[2], rect1[3]]
	const [left2, top2, right2, bottom2] = [rect2[0], rect2[1], rect2[2], rect2[3]]
	if (top1 <= bottom2 || top2 <= bottom1) return false
	if (right1 <= left2 || right2 <= left1) return false
	return true
}

/**
 * Recreate windows, tabs, and groups from saved data, restoring window bounds
 * across monitors (with scaling when the saved layout doesn't fit).
 */
export async function restoreContext({
	tabs,
	windows: savedWindows,
	groups: savedGroups,
}: RestoreData): Promise<void> {
	const loadDisplays: SavedDisplay[] = await new Promise((resolve) => {
		chrome.system.display.getInfo((display) => {
			resolve(display.map(({ bounds: { height, left, top, width } }) => ({ height, left, top, width })))
		})
	})

	const groupMap = new Map<number, Group | SavedGroup>()
	savedGroups.forEach((row) => groupMap.set(row.id, row))

	const groupedByGroups = tabs.reduce(
		(acc, curr) => {
			if (curr.groupId) {
				const data = groupMap.get(curr.groupId)
				if (data) {
					const alreadyGrouped = acc.get(curr.groupId) || { group: data, tabs: [] }
					acc.set(curr.groupId, {
						group: alreadyGrouped.group,
						tabs: [...alreadyGrouped.tabs, curr],
					})
				}
			}
			return acc
		},
		new Map<number, { group: Group | SavedGroup; tabs: SaveableTab[] }>(),
	)

	const groupedTabs = tabs.reduce((acc, curr) => {
		if (curr.windowId) {
			const data = acc.get(curr.windowId) || []
			acc.set(curr.windowId, [...data, curr])
		}
		return acc
	}, new Map<number, SaveableTab[]>())

	const windowLookUp = new Map<number, SavedWindow>()
	savedWindows.forEach((row) => windowLookUp.set(row.id!, row))

	const shouldBeLaterGroupedTabs = new Map<number, SaveableTab[]>()
	const windowPromises = [...groupedTabs.entries()].map(([id, value]) => {
		const saved = windowLookUp.get(id)
		const { height, left, top, width } = saved ?? { height: 800, left: 0, top: 0, width: 1200 }
		const firstTabInWindow = value[0]
		if (firstTabInWindow.groupId) {
			shouldBeLaterGroupedTabs.set(firstTabInWindow.groupId, [firstTabInWindow])
		}
		const isTopNegative = top! < 0
		const newHeight = isTopNegative ? height! * -1 : height!
		const newWidth = width! + left!
		const windowCoordinates = [left!, newHeight, newWidth, top!]

		const fits = loadDisplays.some((row) =>
			areRectanglesOverlap([row.left, row.height, row.width, row.top], windowCoordinates),
		)

		if (fits) {
			return chrome.windows.create({ height, left, top, width, url: firstTabInWindow.url })
		}

		// Doesn't fit the current displays — scale into the primary display.
		const scale = Math.min(loadDisplays[0].width / width!, loadDisplays[0].height / height!)
		const trueHeight = Math.round(scale * height!)
		const trueWidth = Math.round(scale * width!)
		const topx = Math.round(left! * scale)
		const newTopY = height! + top!
		const shoutBeY = Math.round(newTopY * scale)
		const topy = shoutBeY >= 0 ? shoutBeY : shoutBeY * -1

		return chrome.windows.create({
			height: trueHeight,
			left: topx,
			top: topy,
			width: trueWidth,
			url: firstTabInWindow.url,
		})
	})

	const createdWindows = await Promise.all(windowPromises)

	const coolWindowData = createdWindows.map((newChromeWindow, index) => {
		const lilTabGroup = [...groupedTabs.entries()][index][1]
		return {
			newChromeWindow,
			alreadyOpenedTabs: newChromeWindow!.tabs || [],
			tabs: lilTabGroup.map((row) => ({ ...row, newWindowId: newChromeWindow!.id })),
		}
	})

	const createdTabs = await Promise.all(
		coolWindowData.flatMap((row) =>
			row.tabs
				.filter((_row, index) => index !== 0)
				.map((row) => {
					if (row.groupId) {
						const alreadyGroupedTabs = shouldBeLaterGroupedTabs.get(row.groupId) || []
						shouldBeLaterGroupedTabs.set(row.groupId, [...alreadyGroupedTabs, row])
					}
					return chrome.tabs.create({ url: row.url, windowId: row.newWindowId })
				}),
		),
	)

	const upgradedSet = new Map<string, ChromeTab>()
	const addBackIn: ChromeTab[] = [
		...createdTabs,
		...coolWindowData.flatMap(({ alreadyOpenedTabs }) => alreadyOpenedTabs),
	]
	addBackIn.forEach((row) => {
		if (row.status == 'loading' && row?.pendingUrl && row?.id) upgradedSet.set(row.pendingUrl, row)
		if (row.status == 'complete' && row?.url && row?.id) upgradedSet.set(row.url, row)
	})

	groupedByGroups.forEach((lilGroup) => {
		const groupableTabs = shouldBeLaterGroupedTabs.get(lilGroup.group.id)
		if (!groupableTabs) return

		const groupableTabsSet = new Set<string>()
		groupableTabs.forEach((row) => {
			if (row.url) groupableTabsSet.add(row.url)
		})

		const actualTabs = [...upgradedSet]
			.filter(([key]) => groupableTabsSet.has(key))
			.map(([, row]) => row)
		const tabIds = actualTabs.map((row) => row.id!).filter((id): id is number => id != null)

		if (tabIds.length > 0) {
			chrome.tabs
				.group({
					createProperties: { windowId: actualTabs[0].windowId },
					tabIds: tabIds as [number, ...number[]],
				})
				.then((group) => {
					chrome.tabGroups.update(group, {
						collapsed: lilGroup.group.collapsed,
						color: lilGroup.group.color as chrome.tabGroups.Color,
						title: lilGroup.group.title,
					})
				})
		}
	})
}

/** Close all live tabs except the extension's own pages and pinned tabs. */
export async function closeLiveTabs(): Promise<void> {
	const ids = await getCloseableTabIds()
	if (ids.length) await chrome.tabs.remove(ids)
}
