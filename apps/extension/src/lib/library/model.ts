/**
 * The library model: one kind of thing, a Session, replaces both saved sessions and
 * contexts. A session's contents are kept as versions, each a full copy of its
 * windows, groups and tabs. The newest version is what a closed session reopens to.
 *
 * Plain data only, so the migration and its dry run work without Chrome or a store.
 */
import { getHostname } from '@/lib/format'

export type SessionStatus = 'open' | 'closed' | 'archived'
export type SessionKind = 'home' | 'normal' | 'parked'
export type VersionReason = 'switch' | 'close' | 'manual' | 'restore' | 'edit' | 'park' | 'migrated'
/** Where a migrated session came from */
export type SessionOrigin = 'home' | 'context' | 'saved-session' | 'synced-session'

export interface LibrarySession {
	name: string
	/** Notes */
	description: string
	color: string
	kind: SessionKind
	status: SessionStatus
	createdAt: number
	updatedAt: number
	/** 0 when never opened since the migration */
	lastOpenedAt: number
	/** The newest version, or '' for a session with none (Home, a fresh session) */
	headVersionId: string
	/** Tabs in the newest version, so lists never open versions */
	tabCount: number
	/** JSON of up to four { favIconUrl, url } from the newest version, for list previews */
	preview: string
	origin: SessionOrigin
	/** The old context id, saved-session key or synced session id */
	originId: string
}

export interface LibraryVersion {
	sessionId: string
	createdAt: number
	reason: VersionReason
	tabCount: number
	windowCount: number
	groupCount: number
	/** JSON of VersionData. Versions never change, so they're stored whole. */
	data: string
}

export interface VersionTab {
	url: string
	title: string
	favIconUrl: string
	windowId: number
	groupId: number
	active: boolean
}

export interface VersionGroup {
	id: number
	title: string
	color: string
	collapsed: boolean
	windowId: number
}

export interface VersionWindow {
	id: number
	left?: number
	top?: number
	width?: number
	height?: number
}

export interface VersionData {
	tabs: VersionTab[]
	groups: VersionGroup[]
	windows: VersionWindow[]
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
export function makePreview(data: Pick<VersionData, 'tabs'>): string {
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

/** The newest version first; the newest is the one a closed session reopens to */
export function sortVersions<T extends { createdAt: number }>(versions: T[]): T[] {
	return [...versions].sort((a, b) => b.createdAt - a.createdAt)
}

export function makeVersion(
	sessionId: string,
	data: VersionData,
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

export function parseVersion(version: Pick<LibraryVersion, 'data'>): VersionData {
	return JSON.parse(version.data) as VersionData
}
