/**
 * Session actions on the live browser: switch, save a checkpoint, save what's open as a
 * session, put the open session away, open a copy, move tabs, restore a checkpoint, and
 * the two ways to settle an unlinked session.
 *
 * Framework-free, so the side panel, the ⌘K palette and the background worker (the
 * website palette, keyboard commands) all run the same code.
 *
 * Pinned tabs and Papaya's own pages are never saved and never closed.
 */
import { restoreSnapshot, type RestoreResult } from '@/lib/restore'
import { getCloseableTabIds, isOwnPage } from '@/lib/liveTabs'
import {
	MAX_FAVICON_CHARS,
	NO_GROUP,
	compareTabs,
	deriveName,
	emptyContent,
	isRealUrl,
	type CheckpointReason,
	type ContentMode,
	type SavedTab,
	type SessionContent,
} from './model'
import {
	HOME_ID,
	addCheckpoint,
	checkpointContent,
	createSession,
	ensureHome,
	getCheckpointData,
	getLink,
	getOpenSessionId,
	getSession,
	getSessionData,
	listStashed,
	markOpen,
	setContent,
	setLink,
	updateStashed,
	type ContentWrite,
	type Library,
} from './store'

export function toVersionTab(tab: chrome.tabs.Tab, windowId = tab.windowId): SavedTab {
	const favIconUrl = tab.favIconUrl ?? ''
	// A tab still loading (or being restored) can show a blank address before its real one
	const url =
		!isRealUrl(tab.url) && isRealUrl(tab.pendingUrl)
			? tab.pendingUrl
			: tab.url || tab.pendingUrl
	return {
		url: url || '',
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
 * What's open right now, as a session's content: tabs, their groups, and window
 * bounds. Pass tab ids to capture only those (a selection).
 */
export async function captureOpen(onlyTabIds?: number[]): Promise<SessionContent> {
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

/** A save that loses this many of the saved real tabs (or more than half) keeps what it replaces */
export const CAREFUL_LOST_TABS = 5

/** The session the open windows belong to: the open one, or Home when none is */
export const currentSessionId = (lib: Library) => getOpenSessionId(lib) || HOME_ID

export interface LinkDecision {
	/** Whether what's open may be saved into the open session */
	linked: boolean
	/** How saving it treats the content it replaces */
	mode: ContentMode
	/** The first save after the upgrade to checkpoints; clear `adoptLive` once it is written */
	adopting: boolean
}

/**
 * Whether what's open is the open session's content, decided now unless it already is
 * linked, and stored. Linked when the saved content has no real tabs, or at least half
 * of its real tabs' addresses are open. Saving what's open is careful when more than
 * half of them are gone or CAREFUL_LOST_TABS or more are (a window of them closed, say),
 * and on the save that links while some are still missing (Chrome
 * restoring them late, say), so what it replaces is kept.
 *
 * Right after the upgrade, what's open is taken as the session's once, unless it has no
 * real tabs and the session has: an empty window never overwrites a session.
 */
export async function decideLink(
	lib: Library,
	saved: SessionContent,
	capture: SessionContent,
	now = Date.now(),
): Promise<LinkDecision> {
	const { saved: total, open } = compareTabs(saved, capture)
	if (lib.device.get().adoptLive) {
		if (!total || capture.tabs.some((tab) => isRealUrl(tab.url))) {
			await setLink(lib, 'linked', now)
			return { linked: true, mode: 'always', adopting: true }
		}
		await lib.device.set({ adoptLive: false })
	}
	const lost = (total - open) * 2 > total || total - open >= CAREFUL_LOST_TABS
	if (getLink(lib) === 'linked') {
		return { linked: true, mode: lost ? 'careful' : 'routine', adopting: false }
	}
	const linked = !total || open * 2 >= total
	await setLink(lib, linked ? 'linked' : 'unlinked', now)
	return { linked, mode: open < total ? 'careful' : 'routine', adopting: false }
}

/**
 * Save a capture of what's open into the session the windows belong to, if they are
 * linked. Autosave and every action that leaves or copies the open session save this way.
 */
export async function saveLinked(
	lib: Library,
	sessionId: string,
	capture: SessionContent,
	reason: CheckpointReason,
	now = Date.now(),
): Promise<{ linked: boolean; changed: boolean }> {
	const saved = (await getSessionData(lib, sessionId)) ?? emptyContent()
	const decision = await decideLink(lib, saved, capture, now)
	if (!decision.linked) return { linked: false, changed: false }
	const { changed } = await setContent(lib, sessionId, capture, decision.mode, {
		reason: decision.adopting ? 'upgrade' : reason,
		now,
	})
	if (decision.adopting) await lib.device.set({ adoptLive: false })
	return { linked: true, changed }
}

/** The open windows are now the open session's */
async function settleLinked(lib: Library, now: number): Promise<void> {
	await setLink(lib, 'linked', now)
	if (lib.device.get().adoptLive) await lib.device.set({ adoptLive: false })
}

/**
 * Before the browser moves on, save what's open: into the session being left when it is
 * linked; otherwise (its tabs never came back) as a new closed session named from their
 * sites, if any are real, so nothing closes unsaved. Returns that new session's id.
 */
async function leave(lib: Library, fromId: string, now: number): Promise<string | undefined> {
	const capture = await captureOpen()
	if ((await saveLinked(lib, fromId, capture, 'switch', now)).linked) return undefined
	const real = capture.tabs.filter((tab) => isRealUrl(tab.url))
	if (!real.length) return undefined
	return createSession(lib, { name: deriveName('', real) }, capture, now)
}

/** Open a content in new windows; an empty one still gets a window, so closing the old tabs never closes Chrome */
async function reopen(data: SessionContent | null): Promise<string[]> {
	if (data?.tabs.length) return (await restoreSnapshot(data)).failed
	await chrome.windows.create({})
	return []
}

export interface SwitchResult {
	fromId: string
	toId: string
	/** Addresses Chrome refused to reopen */
	failed: string[]
	/** Leaving an unlinked session: the new session the open tabs were saved as */
	savedAs?: string
}

/**
 * Switch to another session: save what's open into the session you're leaving (or, if
 * those tabs aren't its, as a new session), reopen the target, then close the old tabs.
 * Nothing closes until the target is open, and nothing is lost if a step fails before
 * that.
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
	const savedAs = await leave(lib, fromId, now)
	const failed = await reopen(await getSessionData(lib, targetId))
	await markOpen(lib, targetId, now)
	await settleLinked(lib, now)
	if (closeIds.length) await chrome.tabs.remove(closeIds)
	return { fromId, toId: targetId, failed, ...(savedAs ? { savedAs } : {}) }
}

/**
 * Keep a checkpoint of the open session: what's open is saved first (when it is the
 * session's), then copied. Returns null when there is nothing to keep.
 */
export async function saveCheckpoint(lib: Library, now = Date.now()): Promise<string | null> {
	const openId = getOpenSessionId(lib) || ensureHome(lib, now)
	if (!getOpenSessionId(lib)) await markOpen(lib, openId, now)
	await saveLinked(lib, openId, await captureOpen(), 'autosave', now)
	return addCheckpoint(lib, openId, 'manual', now)
}

/**
 * Name what's open: it becomes a new session, and the open one. Coming from Home, Home
 * is left empty, since its tabs and stashed groups now belong to the new session; when
 * the open tabs are not the open session's (unlinked), the session being left stays
 * exactly as it is.
 */
export async function saveOpenAs(lib: Library, name: string, now = Date.now()): Promise<string> {
	const fromId = currentSessionId(lib)
	const capture = await captureOpen()
	const saved = (await getSessionData(lib, fromId)) ?? emptyContent()
	const decision = await decideLink(lib, saved, capture, now)
	const id = await createSession(lib, { name }, capture, now)
	if (decision.linked && fromId === HOME_ID && getSession(lib, HOME_ID)) {
		// Right after the upgrade, Home's last saved tabs may differ from what's open: kept
		await setContent(lib, HOME_ID, emptyContent(), decision.adopting ? 'always' : 'never', {
			reason: 'upgrade',
			now,
		})
		for (const group of listStashed(lib, HOME_ID))
			updateStashed(lib, group.id, { sessionId: id })
	}
	await markOpen(lib, id, now)
	await settleLinked(lib, now)
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
	const real = capture.tabs.filter((tab) => isRealUrl(tab.url))
	return createSession(lib, { name: name?.trim() || deriveName('', real) }, capture, now)
}

/** Put the open session away: save it, close its tabs, and go to Home */
export function putAway(lib: Library, now = Date.now()): Promise<SwitchResult | null> {
	return switchTo(lib, ensureHome(lib, now), now)
}

/** Reopen a session (or one of its checkpoints) next to what's open, without switching */
export async function openCopy(
	lib: Library,
	sessionId: string,
	checkpointId?: string,
): Promise<RestoreResult | null> {
	const data = checkpointId
		? await getCheckpointData(lib, checkpointId)
		: await getSessionData(lib, sessionId)
	return data?.tabs.length ? restoreSnapshot(data) : null
}

export interface CheckpointRestore {
	/** True for the open session, whose windows now show the restored tabs */
	reopened: boolean
	/** Addresses Chrome refused to reopen */
	failed: string[]
	/** Unlinked: the new session the open tabs were saved as before they closed */
	savedAs?: string
}

/**
 * Go back to a checkpoint: its tabs become the session's content, and what they replace
 * becomes a checkpoint. For the session the open windows belong to, those windows are
 * replaced too, as in a switch: what's open is saved first and closes once the
 * checkpoint's tabs are open.
 */
export async function restoreCheckpoint(
	lib: Library,
	sessionId: string,
	checkpointId: string,
	now = Date.now(),
): Promise<CheckpointRestore> {
	const data = await checkpointContent(lib, sessionId, checkpointId)
	const restore = () =>
		setContent(lib, sessionId, data, 'always', { reason: 'restore', now, keep: checkpointId })
	if (sessionId !== currentSessionId(lib)) {
		await restore()
		return { reopened: false, failed: [] }
	}
	const closeIds = await getCloseableTabIds()
	const savedAs = await leave(lib, sessionId, now)
	await restore()
	const failed = await reopen(data)
	await settleLinked(lib, now)
	if (closeIds.length) await chrome.tabs.remove(closeIds)
	return { reopened: true, failed, ...(savedAs ? { savedAs } : {}) }
}

/**
 * Unlinked, "Reopen its tabs": open the open session's saved tabs next to what's open,
 * closing nothing; from then on what's open is the session's
 */
export async function reopenSaved(lib: Library, now = Date.now()): Promise<{ failed: string[] }> {
	const data = await getSessionData(lib, currentSessionId(lib))
	const failed = data?.tabs.length ? (await restoreSnapshot(data)).failed : []
	await settleLinked(lib, now)
	return { failed }
}

/**
 * Unlinked, "Keep what's open": what's open becomes the open session's content, and
 * what it had becomes a checkpoint. Blank tabs alone never replace a session's tabs.
 */
export async function keepOpen(lib: Library, now = Date.now()): Promise<ContentWrite> {
	const openId = getOpenSessionId(lib) || ensureHome(lib, now)
	const capture = await captureOpen()
	const saved = (await getSessionData(lib, openId)) ?? emptyContent()
	const real = (data: SessionContent) => data.tabs.some((tab) => isRealUrl(tab.url))
	if (real(saved) && !real(capture)) {
		throw new Error('No tabs are open to keep')
	}
	const write = await setContent(lib, openId, capture, 'always', {
		reason: 'keep-open',
		now,
	})
	await settleLinked(lib, now)
	return write
}

/**
 * Move some open tabs into another session, then close them: a new closed session with
 * that name, or added to the end of an existing session's content.
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
		const current = (await getSessionData(lib, sessionId)) ?? emptyContent()
		// They join the session's first window, keeping their groups
		const windowId = current.tabs[0]?.windowId ?? 0
		await setContent(
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
			'routine',
			{ reason: 'moved', now },
		)
	}
	await chrome.tabs.remove(moved.tabs.length ? tabIds : [])
	return sessionId
}
