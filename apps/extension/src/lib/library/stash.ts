/**
 * Stashing groups: put an open tab group away inside the open session (its tabs close
 * and are kept), and open it again later. Reopened tabs stay unloaded until clicked, so
 * even a big group opens cheaply.
 *
 * Framework-free, so the side panel, both palettes and the background worker share it.
 */
import { focusGroup } from '@/lib/tabGroups'
import { toVersionTab } from './actions'
import { NO_GROUP } from './model'
import {
	addStashed,
	ensureHome,
	getOpenSessionId,
	getStashed,
	getStashedTabs,
	markOpen,
	removeStashed,
	type Library,
} from './store'

export interface StashResult {
	stashId: string
	name: string
	/** The window the group was in, to reopen it there on Undo */
	windowId: number
}

export interface OpenResult {
	groupId: number
	windowId: number
	/** Addresses Chrome refused to reopen */
	failed: string[]
}

/** The open session, or Home when none is (stashed groups always belong to a session) */
function openSessionOf(lib: Library, now: number): string {
	const open = getOpenSessionId(lib)
	if (open) return open
	const home = ensureHome(lib, now)
	markOpen(lib, home, now)
	return home
}

/**
 * Close tabs without closing their window: a window whose every tab is going gets a
 * new tab first, so Chrome (and the side panel in it) stays open.
 */
async function closeKeepingWindows(tabIds: number[]): Promise<void> {
	const closing = new Set(tabIds)
	const windows = new Set<number>()
	for (const id of tabIds) {
		const tab = await chrome.tabs.get(id).catch(() => null)
		if (tab) windows.add(tab.windowId)
	}
	for (const windowId of windows) {
		const remaining = (await chrome.tabs.query({ windowId })).filter((t) => !closing.has(t.id!))
		if (!remaining.length) await chrome.tabs.create({ windowId, active: true })
	}
	await chrome.tabs.remove(tabIds)
}

/** Put an open tab group away in the open session: its tabs are kept, then closed */
export async function stashGroup(
	lib: Library,
	groupId: number,
	now = Date.now(),
): Promise<StashResult> {
	const [group, tabs] = await Promise.all([
		chrome.tabGroups.get(groupId),
		chrome.tabs.query({ groupId }),
	])
	if (!tabs.length) throw new Error('That group has no tabs')
	const sessionId = openSessionOf(lib, now)
	const name = group.title || 'Unnamed group'
	const stashId = await addStashed(
		lib,
		sessionId,
		{ name, color: group.color },
		tabs.map((tab) => ({ ...toVersionTab(tab, 0), groupId: NO_GROUP, active: false })),
		now,
	)
	await closeKeepingWindows(tabs.map((tab) => tab.id!))
	return { stashId, name, windowId: group.windowId }
}

/** Stash several groups, one at a time (each one's failure doesn't stop the rest) */
export async function stashGroups(lib: Library, groupIds: number[]): Promise<StashResult[]> {
	const results: StashResult[] = []
	for (const groupId of groupIds) {
		try {
			results.push(await stashGroup(lib, groupId))
		} catch (error) {
			console.warn('[papaya] could not stash a group', error)
		}
	}
	return results
}

async function targetWindow(windowId?: number): Promise<number> {
	if (windowId != null) {
		const win = await chrome.windows.get(windowId).catch(() => null)
		if (win?.id != null) return win.id
	}
	const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null)
	if (last?.id != null) return last.id
	const created = await chrome.windows.create({})
	return created!.id!
}

/**
 * Open a stashed group as a tab group at the end of a window, focused, with the other
 * groups folded. Only its first tab loads; the rest stay unloaded until clicked. The
 * stash entry is removed once the group is open.
 */
export async function openStashed(
	lib: Library,
	stashId: string,
	windowId?: number,
): Promise<OpenResult> {
	const stash = getStashed(lib, stashId)
	if (!stash) throw new Error('That group is no longer stashed')
	const tabs = await getStashedTabs(lib, stashId)
	const window = await targetWindow(windowId)

	const created: number[] = []
	const failed: string[] = []
	for (const tab of tabs) {
		try {
			const opened = await chrome.tabs.create({
				windowId: window,
				url: tab.url || undefined,
				active: created.length === 0,
			})
			if (opened.id != null) created.push(opened.id)
		} catch {
			failed.push(tab.url)
		}
	}
	if (!created.length) throw new Error("Chrome wouldn't reopen any of its tabs")

	const groupId = await chrome.tabs.group({
		tabIds: created as [number, ...number[]],
		createProperties: { windowId: window },
	})
	await chrome.tabGroups.update(groupId, {
		title: stash.name,
		color: stash.color as chrome.tabGroups.Color,
		collapsed: false,
	})
	await removeStashed(lib, stashId)
	await focusGroup(groupId)
	// Unload all but the first; Chrome loads each one when it's clicked
	await Promise.all(created.slice(1).map(unloadOnceCommitted))
	return { groupId, windowId: window, failed }
}

const COMMIT_WAIT_MS = 5000

/**
 * Unload a new tab once Chrome has committed its address. Unloading it earlier keeps
 * the address only as pending, which Chrome then drops, leaving a blank tab. A tab
 * that doesn't commit in time just stays loaded.
 */
async function unloadOnceCommitted(tabId: number): Promise<void> {
	for (let waited = 0; waited < COMMIT_WAIT_MS; waited += 100) {
		const tab = await chrome.tabs.get(tabId).catch(() => null)
		if (!tab || tab.active) return
		if (tab.url) {
			await chrome.tabs.discard(tabId).catch(() => null)
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

/** The tab group holding a window's active tab, if any */
async function currentGroupIn(windowId: number): Promise<number | null> {
	const [active] = await chrome.tabs.query({ windowId, active: true })
	const groupId = active?.groupId ?? NO_GROUP
	return groupId === NO_GROUP ? null : groupId
}

/** Swap to a stashed group: open it, then stash the group you were in */
export async function swapToStashed(
	lib: Library,
	stashId: string,
	windowId?: number,
): Promise<{ opened: OpenResult; stashed: StashResult | null }> {
	const window = await targetWindow(windowId)
	const leaving = await currentGroupIn(window)
	const opened = await openStashed(lib, stashId, window)
	const stashed = leaving != null ? await stashGroup(lib, leaving) : null
	return { opened, stashed }
}

/** Swap to an open group: focus it, then stash the group you were in */
export async function swapToGroup(
	lib: Library,
	groupId: number,
): Promise<{ stashed: StashResult | null }> {
	const group = await chrome.tabGroups.get(groupId)
	const leaving = await currentGroupIn(group.windowId)
	await focusGroup(groupId)
	const stashed = leaving != null && leaving !== groupId ? await stashGroup(lib, leaving) : null
	return { stashed }
}
