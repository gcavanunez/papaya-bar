/**
 * restore — reopen saved windows, tabs and tab groups. The one restore engine,
 * shared by saved sessions, context switches and the background worker.
 *
 * Framework-free (`chrome.*` only). Each saved tab is tracked to the tab created for
 * it, so groups and the active tab come back exactly, even when addresses repeat.
 */

export interface SnapshotTab {
	url?: string
	windowId?: number
	groupId?: number
	active?: boolean
}

export interface SnapshotGroup {
	id: number
	title?: string
	color?: string
	collapsed?: boolean
}

export interface SnapshotWindow {
	id?: number
	left?: number
	top?: number
	width?: number
	height?: number
}

export interface Snapshot {
	tabs: SnapshotTab[]
	groups: SnapshotGroup[]
	windows: SnapshotWindow[]
}

export interface RestoreResult {
	windowIds: number[]
	tabIds: number[]
	/** Addresses Chrome refused to open */
	failed: string[]
}

interface Rect {
	left: number
	top: number
	width: number
	height: number
}

const NO_GROUP = -1

function overlapArea(a: Rect, b: Rect): number {
	const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
	const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
	return width > 0 && height > 0 ? width * height : 0
}

/**
 * Where to put a restored window. A window still mostly on a connected display keeps
 * its saved bounds (shrunk to fit that display). One saved on a display that's gone
 * moves to the primary display. Without saved bounds, Chrome decides.
 */
export function placeWindow(saved: SnapshotWindow | undefined, displays: Rect[]): Partial<Rect> {
	if (!saved?.width || !saved?.height) return {}
	const rect: Rect = {
		left: saved.left ?? 0,
		top: saved.top ?? 0,
		width: saved.width,
		height: saved.height,
	}
	if (!displays.length) return rect

	let best = displays[0]
	let bestArea = -1
	for (const display of displays) {
		const area = overlapArea(rect, display)
		if (area > bestArea) [best, bestArea] = [display, area]
	}
	const width = Math.min(rect.width, best.width)
	const height = Math.min(rect.height, best.height)
	if (bestArea >= (rect.width * rect.height) / 4) {
		const left = Math.min(Math.max(rect.left, best.left), best.left + best.width - width)
		const top = Math.min(Math.max(rect.top, best.top), best.top + best.height - height)
		return { left, top, width, height }
	}
	const primary = displays[0]
	return {
		left: primary.left + Math.round((primary.width - Math.min(width, primary.width)) / 2),
		top: primary.top,
		width: Math.min(width, primary.width),
		height: Math.min(height, primary.height),
	}
}

function getDisplays(): Promise<Rect[]> {
	return new Promise((resolve) => {
		if (!chrome.system?.display?.getInfo) return resolve([])
		chrome.system.display.getInfo((info) => resolve(info.map((d) => d.workArea ?? d.bounds)))
	})
}

/** Bucket tabs by saved window, keeping each window's tab order. */
function byWindow(tabs: SnapshotTab[]): Map<number, SnapshotTab[]> {
	const buckets = new Map<number, SnapshotTab[]>()
	for (const tab of tabs) {
		const key = tab.windowId ?? 0
		const list = buckets.get(key) ?? []
		list.push(tab)
		buckets.set(key, list)
	}
	return buckets
}

/** Reopen a snapshot in new windows. Tabs Chrome refuses to open are skipped and listed. */
export async function restoreSnapshot(snapshot: Snapshot): Promise<RestoreResult> {
	const displays = await getDisplays()
	const savedWindows = new Map(snapshot.windows.map((w) => [w.id ?? 0, w]))
	const savedGroups = new Map(snapshot.groups.map((g) => [g.id, g]))
	const result: RestoreResult = { windowIds: [], tabIds: [], failed: [] }

	for (const [windowKey, tabs] of byWindow(snapshot.tabs)) {
		const bounds = placeWindow(savedWindows.get(windowKey), displays)
		const created: (number | null)[] = []

		let win: chrome.windows.Window | undefined
		let placeholder: number | null = null
		try {
			win = await chrome.windows.create({ ...bounds, url: tabs[0].url || undefined })
			created.push(win?.tabs?.[0]?.id ?? null)
		} catch {
			result.failed.push(tabs[0].url ?? '')
			win = await chrome.windows.create({ ...bounds })
			placeholder = win?.tabs?.[0]?.id ?? null
			created.push(null)
		}
		if (win?.id == null) continue
		const windowId = win.id
		result.windowIds.push(windowId)

		const rest = await Promise.all(
			tabs.slice(1).map((tab, i) =>
				chrome.tabs
					.create({ windowId, url: tab.url || undefined, index: i + 1, active: false })
					.then((t) => t.id ?? null)
					.catch(() => {
						result.failed.push(tab.url ?? '')
						return null
					}),
			),
		)
		created.push(...rest)
		if (placeholder != null && created.some((id) => id != null)) {
			await chrome.tabs.remove(placeholder).catch(() => {})
		}

		const activeIndex = tabs.findIndex((tab) => tab.active)
		const activeId = activeIndex === -1 ? null : created[activeIndex]
		if (activeId != null) await chrome.tabs.update(activeId, { active: true }).catch(() => {})

		// Group in order of first appearance; a group whose details are missing stays ungrouped
		const groupTabs = new Map<number, number[]>()
		tabs.forEach((tab, i) => {
			const groupId = tab.groupId ?? NO_GROUP
			const tabId = created[i]
			if (groupId === NO_GROUP || tabId == null || !savedGroups.has(groupId)) return
			groupTabs.set(groupId, [...(groupTabs.get(groupId) ?? []), tabId])
		})
		for (const [savedId, tabIds] of groupTabs) {
			const saved = savedGroups.get(savedId)!
			try {
				const groupId = await chrome.tabs.group({
					tabIds: tabIds as [number, ...number[]],
					createProperties: { windowId },
				})
				await chrome.tabGroups
					.update(groupId, {
						title: saved.title ?? '',
						color: (saved.color ?? 'grey') as chrome.tabGroups.Color,
						collapsed: !!saved.collapsed && !tabIds.includes(activeId ?? NaN),
					})
					.catch(() => {})
			} catch (error) {
				console.warn('[papaya] could not restore a tab group', error)
			}
		}

		result.tabIds.push(...created.filter((id): id is number => id != null))
	}
	return result
}
