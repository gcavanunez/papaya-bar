/**
 * The library model: one kind of thing, a Session, replaces both saved sessions and
 * contexts. A session's content is a full copy of its windows, groups and tabs, and
 * its checkpoints are older copies it can go back to.
 *
 * Plain data only, so the migration and its dry run work without Chrome or a store.
 */
import { getHostname } from '@/lib/format'

/** Derived, never stored: open on this device, archived, or closed */
export type SessionStatus = 'open' | 'closed' | 'archived'
export type SessionKind = 'home' | 'normal'
/** Why a version was saved, in schema 2 and in the move-in from the old stores */
export type VersionReason = 'switch' | 'close' | 'manual' | 'restore' | 'edit' | 'park' | 'migrated'
/**
 * Why a checkpoint was made. Versions that became checkpoints keep their old reason;
 * `autosave` (an autosave or a switch kept the state it replaced), `moved` (tabs moved
 * in), `keep-open` (before "Keep what's open"), `upgrade` (the first save after the
 * upgrade to checkpoints) and `import` (a backup merged over it) are new.
 */
export type CheckpointReason =
	| VersionReason
	| 'autosave'
	| 'moved'
	| 'keep-open'
	| 'upgrade'
	| 'import'
/**
 * When writing a session's content makes the content it replaces a checkpoint:
 * `routine` when the newest checkpoint is over an hour old, `careful` unless one was made
 * in the last 5 minutes, `always`, or `never`
 */
export type ContentMode = 'routine' | 'careful' | 'always' | 'never'
/** Where a migrated session came from; `stashed-group` is a group stashed before schema 4 */
export type SessionOrigin =
	| 'home'
	| 'context'
	| 'saved-session'
	| 'synced-session'
	| 'stashed-group'

export interface LibrarySession {
	name: string
	/** Notes */
	description: string
	color: string
	kind: SessionKind
	/** When it was archived; 0 when it is not */
	archivedAt: number
	createdAt: number
	updatedAt: number
	/** 0 when never opened since the migration */
	lastOpenedAt: number
	/** Its content's entry, or '' for a session with no tabs (Home, a fresh session) */
	contentId: string
	/** Tabs in its content, so lists never open contents */
	tabCount: number
	/** JSON of up to four { favIconUrl, url } from its content, for list previews */
	preview: string
	origin: SessionOrigin
	/** The old context id, saved-session key, synced session id or stash id */
	originId: string
}

/**
 * A session row as schema 1 stored it, with its status, the Parked kind and its newest
 * version. Old indexes and backups hold these, and the move-in from the old stores still
 * plans them.
 */
export interface LibrarySessionV1
	extends Omit<LibrarySession, 'kind' | 'archivedAt' | 'contentId'> {
	kind: SessionKind | 'parked'
	status: SessionStatus
	headVersionId: string
}

/** An older content a session can go back to; its row id is its entry's id */
export interface LibraryCheckpoint {
	sessionId: string
	/** When it was made, which is when its content stopped being the session's */
	createdAt: number
	reason: CheckpointReason
	tabCount: number
	windowCount: number
	groupCount: number
}

/** A version as schema 2 and the move-in from the old stores keep it */
export interface LibraryVersion {
	sessionId: string
	createdAt: number
	reason: VersionReason
	tabCount: number
	windowCount: number
	groupCount: number
	/** JSON of SessionContent. Versions never change, so they're stored whole. */
	data: string
}

export interface SavedTab {
	url: string
	title: string
	favIconUrl: string
	windowId: number
	groupId: number
	active: boolean
}

export interface SavedGroup {
	id: number
	title: string
	color: string
	collapsed: boolean
	windowId: number
}

export interface SavedWindow {
	id: number
	left?: number
	top?: number
	width?: number
	height?: number
}

export interface SessionContent {
	tabs: SavedTab[]
	groups: SavedGroup[]
	windows: SavedWindow[]
}

/**
 * A content that is one tab group and nothing else, as a group saved as a session is.
 * Opening a copy of one adds the group to a window instead of opening new windows.
 */
export function isOneGroup(data: SessionContent): boolean {
	const [group] = data.groups
	return (
		data.groups.length === 1 &&
		data.tabs.length > 0 &&
		data.tabs.every((tab) => tab.groupId === group.id)
	)
}

export const NO_GROUP = -1
/** Data-URL favicons bigger than this are dropped; Papaya falls back to a letter */
export const MAX_FAVICON_CHARS = 4096

/** A session's own title, or the sites it mostly holds ("github.com, reddit.com +3 more") */
export function deriveName(title: string | undefined, tabs: { url?: string }[]): string {
	if (title?.trim()) return title.trim()
	const counts = new Map<string, number>()
	for (const tab of tabs) {
		const host = getHostname(tab.url)
		if (host) counts.set(host, (counts.get(host) ?? 0) + 1)
	}
	const hosts = [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host)
	if (!hosts.length) return 'Untitled session'
	const shown = hosts.slice(0, 2).join(', ')
	return hosts.length > 2 ? `${shown} +${hosts.length - 2} more` : shown
}

/** Icons for a session's list row: the first tab of up to four different sites */
export function makePreview(data: Pick<SessionContent, 'tabs'>): string {
	const seen = new Set<string>()
	const icons: { favIconUrl: string; url: string }[] = []
	for (const tab of data.tabs) {
		const host = getHostname(tab.url)
		if (!host || seen.has(host)) continue
		seen.add(host)
		icons.push({ favIconUrl: tab.favIconUrl, url: tab.url })
		if (icons.length === 4) break
	}
	return JSON.stringify(icons)
}

export function parsePreview(preview: string | undefined): { favIconUrl: string; url: string }[] {
	try {
		return preview ? JSON.parse(preview) : []
	} catch {
		return []
	}
}

/** Newest first */
export function sortVersions<T extends { createdAt: number }>(versions: T[]): T[] {
	return [...versions].sort((a, b) => b.createdAt - a.createdAt)
}

export function makeVersion(
	sessionId: string,
	data: SessionContent,
	reason: VersionReason,
	createdAt: number,
): LibraryVersion {
	return {
		sessionId,
		createdAt,
		reason,
		tabCount: data.tabs.length,
		windowCount: new Set(data.tabs.map((t) => t.windowId)).size,
		groupCount: data.groups.length,
		data: JSON.stringify(data),
	}
}

export function parseVersion(version: Pick<LibraryVersion, 'data'>): SessionContent {
	return JSON.parse(version.data) as SessionContent
}

export const emptyContent = (): SessionContent => ({ tabs: [], groups: [], windows: [] })

export function makeCheckpoint(
	sessionId: string,
	data: SessionContent,
	reason: CheckpointReason,
	createdAt: number,
): LibraryCheckpoint {
	const { data: _json, ...meta } = makeVersion(
		sessionId,
		data,
		reason as VersionReason,
		createdAt,
	)
	return { ...meta, reason }
}

/** Contents are compared as stored, so an unchanged capture never writes a new entry */
export const sameContent = (a: SessionContent, b: SessionContent) =>
	JSON.stringify(a) === JSON.stringify(b)

/** A tab worth keeping: one with an address that isn't a blank or new tab page */
export const isRealUrl = (url: string | undefined) =>
	!!url && url !== 'chrome://newtab/' && url !== 'about:blank'

/**
 * How much of a saved content is open: its real tabs, and how many of their addresses
 * are open, each open tab counting once, so duplicates count
 */
export function compareTabs(
	saved: Pick<SessionContent, 'tabs'>,
	open: Pick<SessionContent, 'tabs'>,
): { saved: number; open: number } {
	const available = new Map<string, number>()
	for (const tab of open.tabs) {
		if (isRealUrl(tab.url)) available.set(tab.url, (available.get(tab.url) ?? 0) + 1)
	}
	let total = 0
	let found = 0
	for (const tab of saved.tabs) {
		if (!isRealUrl(tab.url)) continue
		total++
		const left = available.get(tab.url) ?? 0
		if (left > 0) {
			found++
			available.set(tab.url, left - 1)
		}
	}
	return { saved: total, open: found }
}
