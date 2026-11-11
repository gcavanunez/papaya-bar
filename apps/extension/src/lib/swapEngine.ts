/**
 * swapEngine — framework-free browser operations for the context swap loop.
 *
 * Pure `chrome.*` + logic, no Vue, so it can run in BOTH extension pages and the
 * background service worker (which powers the global content-script palette).
 *
 * - captureLiveData / getCloseableTabIds: read the current browser state
 * - restoreContext: recreate windows/tabs/groups (lib/restore)
 */
import type { Group, SaveableTab } from '@/types'
import type { SavedWindow, SavedDisplay } from '@/hooks/useSessionsData'
import type { SavedGroup } from '@/sync/store'
import { restoreSnapshot, type RestoreResult } from '@/lib/restore'

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

/**
 * Tabs a capture saves. Pinned tabs are left out: a swap never closes them, so saving
 * them would reopen a duplicate every time the context comes back.
 */
export async function queryLiveTabs(): Promise<SaveableTab[]> {
	const tabs = await chrome.tabs.query({})
	return tabs.filter((t) => !isOwnPage(t) && !t.pinned).map(mapToSaveable)
}

export const AUTO_PARK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** Tabs parking may close: untouched for `days`+, not pinned, not active, not Papaya's own. */
export function isParkable(tab: ChromeTab, days = AUTO_PARK_DAYS, now = Date.now()): boolean {
	return (
		tab.id != null &&
		!tab.pinned &&
		!tab.active &&
		!isOwnPage(tab) &&
		(tab.lastAccessed ?? now) < now - days * DAY_MS
	)
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

// ==================== Restore ====================

/** Recreate windows, tabs and groups from saved data (see lib/restore). */
export async function restoreContext(data: RestoreData): Promise<RestoreResult> {
	return restoreSnapshot(data)
}

/** Close all live tabs except the extension's own pages and pinned tabs. */
export async function closeLiveTabs(): Promise<void> {
	const ids = await getCloseableTabIds()
	if (ids.length) await chrome.tabs.remove(ids)
}
