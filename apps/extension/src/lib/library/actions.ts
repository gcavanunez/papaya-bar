/**
 * Session actions on the live browser: switch, save a version, save what's open as a
 * session, put the open session away, open a copy, park stale tabs.
 *
 * Framework-free, so the side panel, the ⌘K palette and the background worker (the
 * website palette, keyboard commands, auto-park) all run the same code.
 *
 * Pinned tabs and Papaya's own pages are never saved and never closed.
 */
import { restoreSnapshot, type RestoreResult } from '@/lib/restore'
import { getCloseableTabIds, isOwnPage } from '@/lib/liveTabs'
import { MAX_FAVICON_CHARS, NO_GROUP, deriveName, type VersionData, type VersionTab } from './model'
import {
	HOME_ID,
	addVersion,
	createSession,
	ensureHome,
	getOpenSessionId,
	getSession,
	getSessionData,
	getVersionData,
	markOpen,
	type Library,
} from './store'

export const PARKED_ID = 'parked'

const EMPTY: VersionData = { tabs: [], groups: [], windows: [] }

function toVersionTab(tab: chrome.tabs.Tab, windowId = tab.windowId): VersionTab {
	const favIconUrl = tab.favIconUrl ?? ''
	return {
		url: tab.url || tab.pendingUrl || '',
		title: tab.title ?? '',
		favIconUrl:
			favIconUrl.startsWith('data:') && favIconUrl.length > MAX_FAVICON_CHARS
				? ''
				: favIconUrl,
		windowId,
		groupId: tab.groupId ?? NO_GROUP,
		active: !!tab.active,
	}
}

/**
 * What's open right now, as a version: tabs, their groups, and window bounds. Pass tab
 * ids to capture only those (a selection).
 */
export async function captureOpen(onlyTabIds?: number[]): Promise<VersionData> {
	const only = onlyTabIds ? new Set(onlyTabIds) : null
	const [tabs, groups, windows] = await Promise.all([
		chrome.tabs.query({ windowType: 'normal' }),
		chrome.tabGroups.query({}),
		chrome.windows.getAll({ windowTypes: ['normal'] }),
	])
	const live = tabs
		.filter((tab) => !tab.pinned && !isOwnPage(tab) && (!only || only.has(tab.id!)))
		.map((tab) => toVersionTab(tab))
	const usedGroups = new Set(live.map((tab) => tab.groupId))
	const usedWindows = new Set(live.map((tab) => tab.windowId))
	return {
		tabs: live,
		groups: groups
			.filter((group) => usedGroups.has(group.id))
			.map((group) => ({
				id: group.id,
				title: group.title ?? '',
				color: group.color,
				collapsed: group.collapsed,
				windowId: group.windowId,
			})),
		windows: windows
			.filter((win) => win.id != null && usedWindows.has(win.id))
			.map((win) => ({
				id: win.id!,
				left: win.left,
				top: win.top,
				width: win.width,
				height: win.height,
			})),
	}
}

export interface SwitchResult {
	fromId: string
	toId: string
	/** Addresses Chrome refused to reopen */
	failed: string[]
}

/**
 * Switch to another session: save what's open as a version of the session you're
 * leaving, reopen the target's newest version, then close the old tabs. Nothing closes
 * until the target is open, and nothing is lost if a step fails before that.
 */
export async function switchTo(
	lib: Library,
	targetId: string,
	now = Date.now(),
): Promise<SwitchResult | null> {
	const fromId = getOpenSessionId(lib) || ensureHome(lib, now)
	if (fromId === targetId && getSession(lib, targetId)?.status === 'open') return null
	if (!getSession(lib, targetId)) throw new Error('That session no longer exists')

	const closeIds = await getCloseableTabIds()
	const capture = await captureOpen()
	const from = getSession(lib, fromId)
	if (from && (capture.tabs.length || from.tabCount)) {
		await addVersion(lib, fromId, capture, 'switch', now)
	}

	const data = await getSessionData(lib, targetId)
	let failed: string[] = []
	if (data?.tabs.length) {
		failed = (await restoreSnapshot(data)).failed
	} else {
		// An empty session still needs a window, or closing the old tabs closes Chrome
		await chrome.windows.create({})
	}
	markOpen(lib, targetId, now)
	if (closeIds.length) await chrome.tabs.remove(closeIds)
	return { fromId, toId: targetId, failed }
}

/** Save a version of the open session without closing anything */
export async function saveVersion(lib: Library, now = Date.now()): Promise<string> {
	const openId = getOpenSessionId(lib) || ensureHome(lib, now)
	if (!getOpenSessionId(lib)) markOpen(lib, openId, now)
	return addVersion(lib, openId, await captureOpen(), 'manual', now)
}

/**
 * Name what's open: it becomes a new session, and the open one. Coming from Home, Home
 * is left empty, since its tabs now belong to the new session.
 */
export async function saveOpenAs(lib: Library, name: string, now = Date.now()): Promise<string> {
	const fromId = getOpenSessionId(lib)
	const capture = await captureOpen()
	const id = await createSession(lib, { name }, capture, now)
	if (fromId === HOME_ID && getSession(lib, HOME_ID)?.tabCount) {
		await addVersion(lib, HOME_ID, EMPTY, 'manual', now)
	}
	markOpen(lib, id, now)
	return id
}

/** Save what's open (or some of it) as a new closed session, leaving everything as it is */
export async function saveCopy(
	lib: Library,
	name?: string,
	tabIds?: number[],
	now = Date.now(),
): Promise<string> {
	const capture = await captureOpen(tabIds)
	return createSession(lib, { name: name?.trim() || deriveName('', capture.tabs) }, capture, now)
}

/** Put the open session away: save it, close its tabs, and go to Home */
export function putAway(lib: Library, now = Date.now()): Promise<SwitchResult | null> {
	return switchTo(lib, ensureHome(lib, now), now)
}

/** Reopen a session (or one of its versions) next to what's open, without switching */
export async function openCopy(
	lib: Library,
	sessionId: string,
	versionId?: string,
): Promise<RestoreResult | null> {
	const data = versionId
		? await getVersionData(lib, versionId)
		: await getSessionData(lib, sessionId)
	return data?.tabs.length ? restoreSnapshot(data) : null
}

/**
 * Move some open tabs into another session, then close them: a new closed session with
 * that name, or added to the end of an existing session's newest version.
 */
export async function moveTabs(
	lib: Library,
	tabIds: number[],
	target: { sessionId: string } | { name: string },
	now = Date.now(),
): Promise<string> {
	const moved = await captureOpen(tabIds)
	if (!moved.tabs.length) throw new Error('Those tabs are no longer open')
	let sessionId: string
	if ('name' in target) {
		sessionId = await createSession(lib, { name: target.name }, moved, now)
	} else {
		sessionId = target.sessionId
		if (sessionId === getOpenSessionId(lib))
			throw new Error('Those tabs are already in that session')
		const current = (await getSessionData(lib, sessionId)) ?? EMPTY
		// They join the session's first window, keeping their groups
		const windowId = current.tabs[0]?.windowId ?? 0
		await addVersion(
			lib,
			sessionId,
			{
				tabs: [
					...current.tabs,
					...moved.tabs.map((tab) => ({ ...tab, windowId, active: false })),
				],
				groups: [
					...current.groups,
					...moved.groups.map((group) => ({ ...group, windowId })),
				],
				windows: current.windows.length ? current.windows : moved.windows.slice(0, 1),
			},
			'manual',
			now,
		)
	}
	await chrome.tabs.remove(moved.tabs.length ? tabIds : [])
	return sessionId
}

/** Move tabs into the Parked session (created on first use) and close them */
export async function parkTabs(
	lib: Library,
	tabs: chrome.tabs.Tab[],
	now = Date.now(),
): Promise<number> {
	const parkable = tabs.filter((tab) => tab.id != null && !tab.pinned && !isOwnPage(tab))
	if (!parkable.length) return 0
	let parkedId = lib.store.getValue('parkedSessionId') as string
	if (!parkedId || !getSession(lib, parkedId)) {
		parkedId = await createSession(
			lib,
			{ id: PARKED_ID, name: 'Parked', kind: 'parked' },
			undefined,
			now,
		)
		lib.store.setValue('parkedSessionId', parkedId)
	}
	const current = (await getSessionData(lib, parkedId)) ?? EMPTY
	await addVersion(
		lib,
		parkedId,
		{
			// Parked tabs reopen together in one window
			tabs: [
				...current.tabs,
				...parkable.map((tab) => ({
					...toVersionTab(tab, 0),
					groupId: NO_GROUP,
					active: false,
				})),
			],
			groups: current.groups,
			windows: current.windows,
		},
		'park',
		now,
	)
	await chrome.tabs.remove(parkable.map((tab) => tab.id!))
	return parkable.length
}
