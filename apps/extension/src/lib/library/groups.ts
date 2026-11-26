/**
 * Saving an open tab group as a session: a new closed session, named and colored after
 * the group, holds its tabs, and then they close. It's a session like any other; opening
 * a copy of it brings the group back into a window (actions.openCopy). Undo, right
 * after saving, reopens the group where it was and deletes the session.
 *
 * Framework-free, so the side panel and the background worker share it.
 */
import { isOwnPage } from '@/lib/liveTabs'
import type { RestoreResult } from '@/lib/restore'
import { captureOpen, openCopy } from './actions'
import { createSession, deleteSession, getOpenSessionId, type Library } from './store'

export interface GroupSaved {
	sessionId: string
	name: string
	/** The window the group was in, to reopen it there on Undo */
	windowId: number
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

/** Save an open tab group as a new closed session, then close its tabs. Papaya's pages stay open. */
export async function saveGroupAsSession(
	lib: Library,
	groupId: number,
	now = Date.now(),
): Promise<GroupSaved> {
	const [group, tabs] = await Promise.all([
		chrome.tabGroups.get(groupId),
		chrome.tabs.query({ groupId }),
	])
	const ids = tabs.filter((tab) => tab.id != null && !isOwnPage(tab)).map((tab) => tab.id!)
	if (!ids.length) throw new Error('That group has no tabs to save')
	const name = group.title?.trim() || 'Unnamed group'
	const content = await captureOpen(ids)
	const sessionId = await createSession(lib, { name, color: group.color }, content, now)
	await closeKeepingWindows(ids)
	return { sessionId, name, windowId: group.windowId }
}

/** Save several groups, one at a time; one that fails doesn't stop the rest */
export async function saveGroupsAsSessions(
	lib: Library,
	groupIds: number[],
): Promise<GroupSaved[]> {
	const saved: GroupSaved[] = []
	for (const groupId of groupIds) {
		try {
			saved.push(await saveGroupAsSession(lib, groupId))
		} catch (error) {
			console.warn('[papaya] could not save a group as a session', error)
		}
	}
	return saved
}

/** Undo saving a group: reopen it in the window it was in, then delete the session it became */
export async function undoSaveGroup(
	lib: Library,
	sessionId: string,
	windowId?: number,
): Promise<RestoreResult> {
	if (getOpenSessionId(lib) === sessionId) throw new Error("It's the open session now")
	const result = await openCopy(lib, sessionId, undefined, windowId)
	if (!result) throw new Error('That session has no tabs to bring back')
	await deleteSession(lib, sessionId)
	return result
}
