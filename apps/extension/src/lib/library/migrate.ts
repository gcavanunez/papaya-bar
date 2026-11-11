/**
 * Plan the move from the two old stores into the library:
 *
 * - Each context becomes a session. Its current tab set and older snapshots become
 *   its versions. The active context becomes the open session; the Parked context
 *   keeps its role.
 * - Each saved session (the Sessions page list) becomes a closed session with one
 *   version, named from its title or its sites.
 * - Saved sessions copied into the newer store by the old save code are dropped
 *   when they match one above, and so are exact duplicates and empty sessions.
 * - With no active context, a Home session becomes the open one.
 *
 * Pure: it reads plain data and returns the rows to write plus a report, so the
 * same code powers the dry run. Ids are derived from the old ids, so running it
 * again gives the same result.
 */
import { parse, isValid } from 'date-fns'
import {
	MAX_FAVICON_CHARS,
	NO_GROUP,
	deriveName,
	makePreview,
	makeVersion,
	type LibrarySession,
	type LibraryVersion,
	type SessionOrigin,
	type VersionData,
	type VersionReason,
	type VersionTab,
} from './model'

type Row = Record<string, unknown>
type Table = Record<string, Row>

/** The old TinyBase store, as `store.getContent()` or a backup's `tinybase` field */
export type OldStoreContent = [Record<string, Table>, Record<string, unknown>] | [] | undefined

export interface OldSavedSession {
	title?: string
	description?: string
	tabs?: {
		url?: string
		title?: string
		favIconUrl?: string
		windowId?: number
		groupId?: number
		active?: boolean
	}[]
	groups?: {
		id: number
		title?: string
		color?: string
		collapsed?: boolean
		windowId?: number
	}[]
	windows?: { id?: number; left?: number; top?: number; width?: number; height?: number }[]
}

type OldCapture = Pick<OldSavedSession, 'tabs' | 'groups' | 'windows'>

/**
 * Changes the old background worker queued for a page to apply (context switches from
 * the website palette, made while no Papaya page was open)
 */
export type PendingOp =
	| { type: 'create'; name: string; capture: OldCapture; activate?: boolean }
	| { type: 'setHead'; contextId: string; capture: OldCapture }
	| { type: 'setActive'; contextId: string }
	| { type: 'append'; contextId: string; tabs: OldSavedSession['tabs'] }

export interface MigrationInput {
	store: OldStoreContent
	/** The Sessions page list: `[savedAt key, session]` pairs from chrome.storage */
	savedSessions: [string, OldSavedSession][] | unknown
	/** Queued context changes not applied yet (`papaya:storeOps`) */
	pendingOps?: PendingOp[] | unknown
	/** Tabs auto-park closed while no page was open (`papaya:parkQueue`) */
	parkQueue?: { url?: string; title?: string; favIconUrl?: string }[] | unknown
	/** Fallback for dates that can't be read */
	now?: number
}

export interface MigrationReport {
	found: {
		contexts: number
		contextVersions: number
		savedSessions: number
		syncedSessions: number
		/** Queued changes and parked tabs that were still waiting to be saved */
		pendingChanges: number
		pendingParked: number
	}
	created: {
		sessions: number
		versions: number
		tabs: number
		archived: number
		home: boolean
		parked: boolean
	}
	openSession: string
	dropped: {
		/** Copies of saved sessions the old save code also wrote to the newer store */
		copies: number
		/** Saved sessions identical to a newer one (same title and tabs) */
		duplicates: number
		/** Sessions with no tabs */
		empty: number
	}
	fixed: {
		/** Tabs that pointed at a group that was never saved; they come back ungrouped */
		missingGroups: number
		/** Data-URL favicons too big to keep; a letter shows instead */
		bigFavicons: number
	}
	largest: { name: string; tabs: number } | null
	oldest: number | null
	newest: number | null
	/** Size of all version data, in bytes */
	bytes: number
	warnings: string[]
}

export interface MigrationResult {
	sessions: Record<string, LibrarySession>
	versions: Record<string, LibraryVersion>
	values: { openSessionId: string; parkedSessionId: string; homeSessionId: string }
	report: MigrationReport
}

const SAVED_KEY_FORMAT = 'hh:mm aaa MM/dd/yyyy'
export const HOME_ID = 'home'

/** Saved-session keys are dates like "08:35 am 09/24/2022"; ids must be safe in links */
const slug = (key: string) =>
	key
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback = 0) =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback

function savedAt(key: string, fallback: number): number {
	const parsed = parse(key, SAVED_KEY_FORMAT, new Date(0))
	if (isValid(parsed)) return parsed.getTime()
	const loose = new Date(key).getTime()
	return Number.isFinite(loose) ? loose : fallback
}

/** Identity of a tab set, ignoring order: used to spot copies across the two stores */
function tabSetKey(tabs: { url?: string }[]): string {
	return tabs
		.map((t) => t.url ?? '')
		.sort()
		.join('\n')
}

interface Fixes {
	missingGroups: number
	bigFavicons: number
}

/** Normalize one tab set, dropping references to groups that weren't saved */
function cleanData(
	tabs: OldSavedSession['tabs'],
	groups: OldSavedSession['groups'],
	windows: OldSavedSession['windows'],
	fixes: Fixes,
): VersionData {
	const cleanGroups = (groups ?? [])
		.filter((g) => typeof g?.id === 'number')
		.map((g) => ({
			id: g.id,
			title: str(g.title),
			color: str(g.color) || 'grey',
			collapsed: !!g.collapsed,
			windowId: num(g.windowId),
		}))
	const groupIds = new Set(cleanGroups.map((g) => g.id))
	const cleanTabs: VersionTab[] = (tabs ?? []).map((t) => {
		let groupId = num(t.groupId, NO_GROUP)
		if (groupId !== NO_GROUP && !groupIds.has(groupId)) {
			fixes.missingGroups++
			groupId = NO_GROUP
		}
		let favIconUrl = str(t.favIconUrl)
		if (favIconUrl.startsWith('data:') && favIconUrl.length > MAX_FAVICON_CHARS) {
			fixes.bigFavicons++
			favIconUrl = ''
		}
		return {
			url: str(t.url),
			title: str(t.title),
			favIconUrl,
			windowId: num(t.windowId),
			groupId,
			active: !!t.active,
		}
	})
	const usedGroups = new Set(cleanTabs.map((t) => t.groupId))
	return {
		tabs: cleanTabs,
		groups: cleanGroups.filter((g) => usedGroups.has(g.id)),
		windows: (windows ?? []).map((w) => ({
			id: num(w.id),
			left: w.left,
			top: w.top,
			width: w.width,
			height: w.height,
		})),
	}
}

/** Read one old TinyBase session (tabs, groups and windows rows) into plain data */
function readStoreSession(
	sessionId: string,
	byOwner: Map<string, { tabs: Row[]; groups: Row[]; windows: Row[] }>,
	fixes: Fixes,
): VersionData {
	const rows = byOwner.get(sessionId) ?? { tabs: [], groups: [], windows: [] }
	const tabs = [...rows.tabs].sort((a, b) => num(a.index) - num(b.index))
	return cleanData(
		tabs.map((t) => ({
			url: str(t.url),
			title: str(t.title),
			favIconUrl: str(t.favIconUrl),
			windowId: num(t.windowId),
			groupId: num(t.groupId, NO_GROUP),
			active: !!t.active,
		})),
		rows.groups.map((g) => ({
			id: num(g.originalId),
			title: str(g.title),
			color: str(g.color),
			collapsed: !!g.collapsed,
			windowId: num(g.windowId),
		})),
		rows.windows.map((w) => ({
			id: num(w.originalId),
			left: num(w.left),
			top: num(w.top),
			width: num(w.width),
			height: num(w.height),
		})),
		fixes,
	)
}

/** Clean up one saved-session file (the Download format) into version data, for Import */
export function savedSessionToData(session: OldSavedSession): VersionData {
	if (!Array.isArray(session?.tabs))
		throw new Error('That file doesn’t look like a saved session')
	return cleanData(session.tabs, session.groups, session.windows, {
		missingGroups: 0,
		bigFavicons: 0,
	})
}

export function planMigration(input: MigrationInput): MigrationResult {
	const now = input.now ?? Date.now()
	const [tables = {}, values = {}] = (input.store ?? []) as [Record<string, Table>?, Row?]
	const contexts = tables.contexts ?? {}
	const oldSessions = tables.sessions ?? {}
	const savedSessions = Array.isArray(input.savedSessions)
		? (input.savedSessions as [string, OldSavedSession][]).filter(
				(entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[1],
			)
		: []

	const fixes: Fixes = { missingGroups: 0, bigFavicons: 0 }
	const warnings: string[] = []
	const sessions: Record<string, LibrarySession> = {}
	const versions: Record<string, LibraryVersion> = {}
	const dropped = { copies: 0, duplicates: 0, empty: 0 }

	// Index tabs, groups and windows rows by the old session they belong to
	const byOwner = new Map<string, { tabs: Row[]; groups: Row[]; windows: Row[] }>()
	for (const kind of ['tabs', 'groups', 'windows'] as const) {
		for (const row of Object.values(tables[kind] ?? {})) {
			const owner = str(row.sessionId)
			const entry = byOwner.get(owner) ?? { tabs: [], groups: [], windows: [] }
			entry[kind].push(row)
			byOwner.set(owner, entry)
		}
	}

	function addSession(
		id: string,
		session: Omit<LibrarySession, 'headVersionId' | 'tabCount' | 'preview'>,
		sessionVersions: {
			id: string
			data: VersionData
			reason: VersionReason
			createdAt: number
		}[],
	) {
		const ordered = [...sessionVersions].sort((a, b) => b.createdAt - a.createdAt)
		for (const v of ordered) versions[v.id] = makeVersion(id, v.data, v.reason, v.createdAt)
		const head = ordered[0]
		sessions[id] = {
			...session,
			headVersionId: head?.id ?? '',
			tabCount: head?.data.tabs.length ?? 0,
			preview: makePreview(head?.data ?? { tabs: [] }),
			updatedAt: Math.max(session.updatedAt, head?.createdAt ?? 0),
		}
	}

	// ---------- Contexts ----------
	const activeContextId = str(values.activeContextId)
	const parkedContextId = str(values.parkedContextId)
	let openSessionId = ''
	let parkedSessionId = ''
	let contextVersions = 0

	for (const [contextId, ctx] of Object.entries(contexts)) {
		const id = `ctx-${contextId}`
		const headId = str(ctx.headSessionId)
		const owned = Object.entries(oldSessions).filter(([, s]) => str(s.contextId) === contextId)
		if (headId && !oldSessions[headId])
			warnings.push(`Context "${str(ctx.name)}" had lost its tabs`)
		const ctxVersions = owned.map(([sessionId, s]) => ({
			id: `${id}-v-${sessionId}`,
			data: readStoreSession(sessionId, byOwner, fixes),
			reason: (sessionId === headId ? 'migrated' : 'switch') as VersionReason,
			// Make sure the current tab set stays the newest
			createdAt:
				sessionId === headId
					? Math.max(num(s.createdAt, now), num(ctx.updatedAt))
					: num(s.createdAt, now),
		}))
		contextVersions += ctxVersions.length

		const isOpen = contextId === activeContextId
		const isParked = contextId === parkedContextId
		if (isOpen) openSessionId = id
		if (isParked) parkedSessionId = id
		const status = isOpen ? 'open' : str(ctx.status) === 'archived' ? 'archived' : 'closed'
		addSession(
			id,
			{
				name: str(ctx.name) || 'Untitled session',
				description: '',
				color: str(ctx.color) || 'grey',
				kind: isParked ? 'parked' : 'normal',
				status,
				createdAt: num(ctx.createdAt, now),
				updatedAt: num(ctx.updatedAt, now),
				lastOpenedAt: 0,
				origin: 'context',
				originId: contextId,
			},
			ctxVersions,
		)
	}

	// ---------- Saved sessions (the Sessions page) ----------
	// Newest first, so an exact duplicate keeps its most recent copy
	const savedByDate = savedSessions
		.map(([key, s]) => ({ key, s, at: savedAt(key, now) }))
		.sort((a, b) => b.at - a.at)
	const seenSaved = new Set<string>()
	const savedTabSets = new Set<string>()
	for (const { key, s, at } of savedByDate) {
		const tabs = Array.isArray(s.tabs) ? s.tabs : []
		if (!tabs.length) {
			dropped.empty++
			continue
		}
		const exact = `${str(s.title).trim().toLowerCase()}\n${tabs.map((t) => t.url ?? '').join('\n')}`
		if (seenSaved.has(exact)) {
			dropped.duplicates++
			continue
		}
		seenSaved.add(exact)
		savedTabSets.add(tabSetKey(tabs))
		let id = `saved-${slug(key)}`
		while (sessions[id]) id += '-x'
		const data = cleanData(tabs, s.groups, s.windows, fixes)
		addSession(
			id,
			{
				name: deriveName(s.title, tabs),
				description: str(s.description),
				color: 'grey',
				kind: 'normal',
				status: 'closed',
				createdAt: at,
				updatedAt: at,
				lastOpenedAt: 0,
				origin: 'saved-session',
				originId: key,
			},
			[{ id: `${id}-v1`, data, reason: 'migrated', createdAt: at }],
		)
	}

	// ---------- Standalone sessions in the newer store ----------
	let syncedSessions = 0
	for (const [sessionId, s] of Object.entries(oldSessions)) {
		const owner = str(s.contextId)
		if (owner && contexts[owner]) continue
		if (owner)
			warnings.push(
				`A snapshot belonged to a context that no longer exists; kept as a session`,
			)
		syncedSessions++
		const data = readStoreSession(sessionId, byOwner, fixes)
		if (!data.tabs.length) {
			dropped.empty++
			continue
		}
		if (savedTabSets.has(tabSetKey(data.tabs))) {
			dropped.copies++
			continue
		}
		savedTabSets.add(tabSetKey(data.tabs))
		const id = `synced-${sessionId}`
		const at = num(s.createdAt, now)
		addSession(
			id,
			{
				name: deriveName(str(s.title), data.tabs),
				description: str(s.description),
				color: 'grey',
				kind: 'normal',
				status: 'closed',
				createdAt: at,
				updatedAt: num(s.updatedAt, at),
				lastOpenedAt: 0,
				origin: 'synced-session' as SessionOrigin,
				originId: sessionId,
			},
			[{ id: `${id}-v1`, data, reason: 'migrated', createdAt: at }],
		)
	}

	// ---------- Changes still queued by the old background worker ----------
	// Applied in order, as the old side panel would have, on top of everything above

	/** Make `data` the newest version of a session */
	function pushVersion(id: string, data: VersionData, reason: VersionReason, at: number) {
		const versionId = `${id}-q${Object.keys(versions).length}`
		versions[versionId] = makeVersion(id, data, reason, at)
		Object.assign(sessions[id], {
			headVersionId: versionId,
			tabCount: data.tabs.length,
			preview: makePreview(data),
			updatedAt: Math.max(sessions[id].updatedAt, at),
		})
	}
	const headData = (id: string): VersionData => {
		const head = versions[sessions[id]?.headVersionId ?? '']
		return head ? (JSON.parse(head.data) as VersionData) : { tabs: [], groups: [], windows: [] }
	}
	const newSession = (id: string, name: string, kind: LibrarySession['kind'], at: number) =>
		addSession(
			id,
			{
				name,
				description: '',
				color: 'grey',
				kind,
				status: 'closed',
				createdAt: at,
				updatedAt: at,
				lastOpenedAt: 0,
				origin: 'context',
				originId: '',
			},
			[],
		)

	const pendingOps = Array.isArray(input.pendingOps) ? (input.pendingOps as PendingOp[]) : []
	pendingOps.forEach((op, i) => {
		const at = now + i + 1
		if (op?.type === 'create') {
			const id = `queued-${i}`
			newSession(id, str(op.name) || 'Unsorted', 'normal', at)
			pushVersion(
				id,
				cleanData(op.capture?.tabs, op.capture?.groups, op.capture?.windows, fixes),
				'switch',
				at,
			)
			if (op.activate) openSessionId = id
		} else if (op?.type === 'setHead') {
			let id = `ctx-${op.contextId}`
			if (!sessions[id]) {
				id = `queued-${i}`
				newSession(id, 'Recovered tabs', 'normal', at)
			}
			pushVersion(
				id,
				cleanData(op.capture?.tabs, op.capture?.groups, op.capture?.windows, fixes),
				'switch',
				at,
			)
		} else if (op?.type === 'setActive') {
			openSessionId =
				op.contextId && sessions[`ctx-${op.contextId}`] ? `ctx-${op.contextId}` : ''
		} else if (op?.type === 'append' && sessions[`ctx-${op.contextId}`]) {
			const id = `ctx-${op.contextId}`
			const current = headData(id)
			const added = cleanData(op.tabs, [], [], fixes).tabs
			pushVersion(id, { ...current, tabs: [...current.tabs, ...added] }, 'park', at)
		}
	})

	const parkQueue = Array.isArray(input.parkQueue)
		? (input.parkQueue as { url?: string; title?: string; favIconUrl?: string }[])
		: []
	if (parkQueue.length) {
		if (!parkedSessionId || !sessions[parkedSessionId]) {
			parkedSessionId = 'parked'
			newSession(parkedSessionId, 'Parked', 'parked', now)
		}
		const current = headData(parkedSessionId)
		const added = cleanData(
			parkQueue.map((tab) => ({ ...tab, windowId: 0, groupId: NO_GROUP, active: false })),
			[],
			[],
			fixes,
		).tabs
		pushVersion(
			parkedSessionId,
			{ ...current, tabs: [...current.tabs, ...added] },
			'park',
			now + pendingOps.length + 1,
		)
	}

	// Exactly one open session: the one the queued changes (or the old store) left active
	for (const [id, session] of Object.entries(sessions)) {
		if (session.status === 'open' && id !== openSessionId) session.status = 'closed'
	}
	if (openSessionId) sessions[openSessionId].status = 'open'

	// ---------- Home ----------
	let homeSessionId = ''
	if (!openSessionId) {
		homeSessionId = HOME_ID
		openSessionId = HOME_ID
		addSession(
			HOME_ID,
			{
				name: 'Home',
				description: '',
				color: 'grey',
				kind: 'home',
				status: 'open',
				createdAt: now,
				updatedAt: now,
				lastOpenedAt: now,
				origin: 'home',
				originId: '',
			},
			[],
		)
	}

	// ---------- Report ----------
	const all = Object.values(sessions)
	const dated = all.filter((s) => s.kind !== 'home').map((s) => s.createdAt)
	const largest = all.reduce<LibrarySession | null>(
		(best, s) => (!best || s.tabCount > best.tabCount ? s : best),
		null,
	)
	const report: MigrationReport = {
		found: {
			contexts: Object.keys(contexts).length,
			contextVersions,
			savedSessions: savedSessions.length,
			syncedSessions,
			pendingChanges: pendingOps.length,
			pendingParked: parkQueue.length,
		},
		created: {
			sessions: all.length,
			versions: Object.keys(versions).length,
			tabs: all.reduce((n, s) => n + s.tabCount, 0),
			archived: all.filter((s) => s.status === 'archived').length,
			home: !!homeSessionId,
			parked: !!parkedSessionId,
		},
		openSession: sessions[openSessionId]?.name ?? '',
		dropped,
		fixed: fixes,
		largest:
			largest && largest.tabCount ? { name: largest.name, tabs: largest.tabCount } : null,
		oldest: dated.length ? Math.min(...dated) : null,
		newest: dated.length ? Math.max(...dated) : null,
		bytes: Object.values(versions).reduce((n, v) => n + v.data.length, 0),
		warnings: [...new Set(warnings)],
	}

	return {
		sessions,
		versions,
		values: { openSessionId, parkedSessionId, homeSessionId },
		report,
	}
}
