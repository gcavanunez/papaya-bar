/**
 * The library: sessions, their content and their checkpoints.
 *
 * The index (sessions and their checkpoints) is a TinyBase MergeableStore, so
 * copies in different pages and the background worker merge instead of overwriting each
 * other. Contents (a session's tabs, a checkpoint's) live in `blobs`,
 * one entry each, so the index stays small. Every entry has exactly one owner, so an
 * owner going away is the only reason to delete its entry.
 * The old stores are never touched and serve as the rollback copy.
 *
 * Every function takes the library first, so tests can use a fresh one.
 */
import { createMergeableStore, type MergeableStore } from 'tinybase'
import { memoryBlobs, type ContentBlobs } from './blobs'
import type { MigrationResult } from './migrate'
import {
	emptyContent,
	isRealUrl,
	makeCheckpoint,
	makePreview,
	parseVersion,
	sameContent,
	type CheckpointReason,
	type ContentMode,
	type LibraryCheckpoint,
	type LibrarySession,
	type SessionContent,
	type SessionStatus,
} from './model'
import {
	memoryDevice,
	memoryRuntime,
	type DeviceState,
	type Link,
	type RuntimeState,
	type StateStore,
} from './state'
import { upgradeLibrary } from './upgrade'

export const LIBRARY_STORE_ID = 'papaya-library'
/** Checkpoints kept per session, newest first */
export const MAX_CHECKPOINTS = 10
/** A routine save keeps what it replaces when the newest checkpoint is older than this */
export const ROUTINE_CHECKPOINT_MS = 60 * 60 * 1000
/** A careful save keeps what it replaces unless a checkpoint is younger than this */
export const CAREFUL_CHECKPOINT_MS = 5 * 60 * 1000
export const HOME_ID = 'home'

export interface Library {
	store: MergeableStore
	blobs: ContentBlobs
	/** This browser's own state, such as its open session; never synced */
	device: StateStore<DeviceState>
	/** This browser run's state: whether the open windows are the open session's */
	runtime: StateStore<RuntimeState>
	/**
	 * Delete entries the index no longer refers to, once that index is stored, so a
	 * stopped worker never leaves the stored index pointing at nothing. A library kept
	 * in memory deletes them at once.
	 */
	dropEntries(ids: string[]): Promise<void>
}

export interface SessionSummary extends LibrarySession {
	id: string
	status: SessionStatus
}

export interface CheckpointSummary extends LibraryCheckpoint {
	id: string
}

/**
 * TinyBase drops tables, cells and values a schema doesn't declare when it loads stored
 * content, so names older schemas used stay declared until the upgrade has moved them
 * out. They have no default: deleting a cell that has one only resets it.
 */
const LEGACY_SESSION_CELLS = {
	/** Schema 1 */
	status: { type: 'string' },
	/** Schema 2: now `contentId` */
	headVersionId: { type: 'string' },
} as const
const LEGACY_TABLES = {
	/** Schema 2: now `checkpoints`, and each session's content */
	versions: {
		sessionId: { type: 'string' },
		createdAt: { type: 'number' },
		reason: { type: 'string' },
		tabCount: { type: 'number' },
		windowCount: { type: 'number' },
		groupCount: { type: 'number' },
	},
	/** Schemas 1 to 3: groups stashed in a session; each is a session of its own since 4 */
	stashed: {
		sessionId: { type: 'string' },
		name: { type: 'string' },
		color: { type: 'string' },
		tabCount: { type: 'number' },
		preview: { type: 'string' },
		createdAt: { type: 'number' },
	},
} as const
const LEGACY_VALUES = {
	/** Schema 1 */
	openSessionId: { type: 'string' },
	parkedSessionId: { type: 'string' },
	homeSessionId: { type: 'string' },
} as const

export function createLibrary(
	blobs: ContentBlobs = memoryBlobs(),
	device: StateStore<DeviceState> = memoryDevice(),
	runtime: StateStore<RuntimeState> = memoryRuntime(),
): Library {
	const store = createMergeableStore(LIBRARY_STORE_ID)
	store.setTablesSchema({
		sessions: {
			name: { type: 'string', default: '' },
			description: { type: 'string', default: '' },
			color: { type: 'string', default: 'grey' },
			kind: { type: 'string', default: 'normal' },
			archivedAt: { type: 'number', default: 0 },
			...LEGACY_SESSION_CELLS,
			createdAt: { type: 'number', default: 0 },
			updatedAt: { type: 'number', default: 0 },
			lastOpenedAt: { type: 'number', default: 0 },
			contentId: { type: 'string', default: '' },
			tabCount: { type: 'number', default: 0 },
			preview: { type: 'string', default: '[]' },
			origin: { type: 'string', default: '' },
			originId: { type: 'string', default: '' },
		},
		checkpoints: {
			sessionId: { type: 'string', default: '' },
			createdAt: { type: 'number', default: 0 },
			reason: { type: 'string', default: 'manual' },
			tabCount: { type: 'number', default: 0 },
			windowCount: { type: 'number', default: 0 },
			groupCount: { type: 'number', default: 0 },
		},
		...LEGACY_TABLES,
	})
	store.setValuesSchema({
		...LEGACY_VALUES,
		schemaVersion: { type: 'number', default: 0 },
		migratedAt: { type: 'number', default: 0 },
	})
	return { store, blobs, device, runtime, dropEntries: (ids) => blobs.delete(ids) }
}

// ==================== Reading ====================

function summarize(lib: Library, id: string, row: Record<string, unknown>): SessionSummary {
	const session = { ...row, id } as unknown as SessionSummary
	session.status =
		id === getOpenSessionId(lib) ? 'open' : session.archivedAt > 0 ? 'archived' : 'closed'
	return session
}

export function getSession(lib: Library, id: string): SessionSummary | null {
	const row = lib.store.getRow('sessions', id)
	return Object.keys(row).length ? summarize(lib, id, row) : null
}

/** When a session was last used: opened, switched away from, or saved */
export const lastUsed = (s: Pick<LibrarySession, 'lastOpenedAt' | 'updatedAt'>) =>
	Math.max(s.lastOpenedAt, s.updatedAt)

/** Sessions without their contents, most recently used first */
export function listSessions(
	lib: Library,
	filter: { status?: SessionStatus | SessionStatus[] } = {},
): SessionSummary[] {
	const statuses = filter.status == null ? null : [filter.status].flat()
	return Object.entries(lib.store.getTable('sessions'))
		.map(([id, row]) => summarize(lib, id, row))
		.filter((s) => !statuses || statuses.includes(s.status))
		.sort((a, b) => lastUsed(b) - lastUsed(a))
}

/** A session's checkpoints without their contents, newest first */
export function listCheckpoints(lib: Library, sessionId: string): CheckpointSummary[] {
	return Object.entries(lib.store.getTable('checkpoints'))
		.filter(([, row]) => row.sessionId === sessionId)
		.map(([id, row]) => ({ id, ...row }) as CheckpointSummary)
		.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
}

export function getCheckpoint(lib: Library, id: string): CheckpointSummary | null {
	const row = lib.store.getRow('checkpoints', id)
	return Object.keys(row).length ? ({ id, ...row } as CheckpointSummary) : null
}

export function getCheckpointData(
	lib: Library,
	checkpointId: string,
): Promise<SessionContent | null> {
	return lib.blobs.get(checkpointId)
}

/** A session's content: what a closed session reopens to; null when it has none */
export async function getSessionData(
	lib: Library,
	sessionId: string,
): Promise<SessionContent | null> {
	const contentId = getSession(lib, sessionId)?.contentId
	return contentId ? lib.blobs.get(contentId) : null
}

/** The session this browser has open, or '' for Home */
export function getOpenSessionId(lib: Library): string {
	return lib.device.get().openSessionId
}

/** Whether the open windows are the open session's tabs, as this browser run knows it */
export function getLink(lib: Library): Link {
	return lib.runtime.get().link
}

export function isMigrated(lib: Library): boolean {
	return !!lib.store.getValue('migratedAt')
}

// ==================== Writing ====================

const newId = () => crypto.randomUUID()

export async function createSession(
	lib: Library,
	fields: {
		name: string
		description?: string
		color?: string
		status?: Exclude<SessionStatus, 'open'>
		kind?: LibrarySession['kind']
		id?: string
	},
	data?: SessionContent,
	now = Date.now(),
): Promise<string> {
	const id = fields.id ?? newId()
	lib.store.setRow('sessions', id, {
		name: fields.name,
		description: fields.description ?? '',
		color: fields.color ?? 'grey',
		kind: fields.kind ?? 'normal',
		archivedAt: fields.status === 'archived' ? now : 0,
		createdAt: now,
		updatedAt: now,
		lastOpenedAt: 0,
		contentId: '',
		tabCount: 0,
		preview: '[]',
		origin: '',
		originId: '',
	})
	if (data) await setContent(lib, id, data, 'never', { now })
	return id
}

export interface ContentWrite {
	/** False when the content already was this, and nothing was written */
	changed: boolean
	/** The checkpoint the replaced content became, if it became one */
	checkpointId: string | null
}

/**
 * The one way a session's content is written. Nothing happens if it is unchanged.
 * Otherwise the new entry is stored before the session points at it, and the content it
 * replaces becomes a checkpoint (as `mode` decides; content with no real tabs never
 * does) or is deleted. Only the newest MAX_CHECKPOINTS checkpoints are kept; `keep` is never one
 * of those pushed out.
 */
export async function setContent(
	lib: Library,
	sessionId: string,
	data: SessionContent,
	mode: ContentMode,
	options: { reason?: CheckpointReason; now?: number; keep?: string } = {},
): Promise<ContentWrite> {
	const { reason = 'autosave', now = Date.now() } = options
	const session = getSession(lib, sessionId)
	if (!session) throw new Error('That session no longer exists')
	const oldId = session.contentId
	const old = oldId ? await lib.blobs.get(oldId) : emptyContent()
	if (old && sameContent(old, data)) return { changed: false, checkpointId: null }

	const kept = !!old && hasRealTabs(old) && wantsCheckpoint(lib, sessionId, mode, now)
	// A session with no tabs points at nothing
	const id = data.tabs.length ? newId() : ''
	if (id) await lib.blobs.set({ [id]: data })
	let pruned: string[] = []
	lib.store.transaction(() => {
		lib.store.setPartialRow('sessions', sessionId, {
			contentId: id,
			tabCount: data.tabs.length,
			preview: makePreview(data),
			updatedAt: now,
		})
		if (kept) {
			lib.store.setRow('checkpoints', oldId, {
				...makeCheckpoint(sessionId, old!, reason, checkpointTime(lib, sessionId, now)),
			})
		}
		pruned = pruneCheckpoints(lib, sessionId, options.keep)
	})
	await releaseEntries(lib, [...(kept ? [] : [oldId]), ...pruned])
	return { changed: true, checkpointId: kept ? oldId : null }
}

/** Later than the session's newest checkpoint, so they always list in the order they were made */
function checkpointTime(lib: Library, sessionId: string, now: number): number {
	const newest = listCheckpoints(lib, sessionId)[0]?.createdAt ?? -Infinity
	return Math.max(now, newest + 1)
}

function wantsCheckpoint(lib: Library, sessionId: string, mode: ContentMode, now: number) {
	if (mode === 'always' || mode === 'never') return mode === 'always'
	const newest = listCheckpoints(lib, sessionId)[0]?.createdAt
	if (newest == null) return true
	return mode === 'routine'
		? now - newest > ROUTINE_CHECKPOINT_MS
		: now - newest >= CAREFUL_CHECKPOINT_MS
}

/** Delete the rows of a session's checkpoints past the newest MAX_CHECKPOINTS; returns their ids */
function pruneCheckpoints(lib: Library, sessionId: string, keep?: string): string[] {
	const all = listCheckpoints(lib, sessionId)
	const ordered = [...all.filter((c) => c.id === keep), ...all.filter((c) => c.id !== keep)]
	const pruned = ordered.slice(MAX_CHECKPOINTS).map((c) => c.id)
	for (const id of pruned) lib.store.delRow('checkpoints', id)
	return pruned
}

/** Every entry id the index refers to, including older schemas' tables not yet upgraded */
export function referencedEntries(lib: Library): Set<string> {
	const ids = new Set([
		...Object.keys(lib.store.getTable('checkpoints')),
		...Object.keys(lib.store.getTable('stashed')),
		...Object.keys(lib.store.getTable('versions')),
	])
	for (const row of Object.values(lib.store.getTable('sessions'))) {
		if (row.contentId) ids.add(String(row.contentId))
		if (row.headVersionId) ids.add(String(row.headVersionId))
	}
	return ids
}

/** Delete entries once nothing in the index refers to them (an owner went away) */
export async function releaseEntries(lib: Library, ids: string[]): Promise<void> {
	const used = referencedEntries(lib)
	const free = [...new Set(ids)].filter((id) => id && !used.has(id))
	if (free.length) await lib.dropEntries(free)
}

/** Blank and new tab pages alone are nothing worth going back to */
const hasRealTabs = (data: SessionContent) => data.tabs.some((tab) => isRealUrl(tab.url))

/**
 * Keep a copy of a session's content as a checkpoint, leaving the content as it is.
 * Returns null when there is nothing to keep (no real tabs).
 */
export async function addCheckpoint(
	lib: Library,
	sessionId: string,
	reason: CheckpointReason,
	now = Date.now(),
): Promise<string | null> {
	const data = await getSessionData(lib, sessionId)
	if (!data || !hasRealTabs(data)) return null
	const id = newId()
	await lib.blobs.set({ [id]: data })
	let pruned: string[] = []
	lib.store.transaction(() => {
		lib.store.setRow('checkpoints', id, {
			...makeCheckpoint(sessionId, data, reason, checkpointTime(lib, sessionId, now)),
		})
		pruned = pruneCheckpoints(lib, sessionId, id)
	})
	await releaseEntries(lib, pruned)
	return id
}

/**
 * Make a checkpoint's content the session's again; the content it replaces becomes a
 * checkpoint, and the restored checkpoint stays. This only writes the library: for the
 * open session, `actions.restoreCheckpoint` also reopens it in the browser.
 */
export async function restoreCheckpoint(
	lib: Library,
	sessionId: string,
	checkpointId: string,
	now = Date.now(),
): Promise<ContentWrite> {
	const data = await checkpointContent(lib, sessionId, checkpointId)
	return setContent(lib, sessionId, data, 'always', {
		reason: 'restore',
		now,
		keep: checkpointId,
	})
}

/** A checkpoint's tabs, checked to belong to the session */
export async function checkpointContent(
	lib: Library,
	sessionId: string,
	checkpointId: string,
): Promise<SessionContent> {
	if (getCheckpoint(lib, checkpointId)?.sessionId !== sessionId) {
		throw new Error('That checkpoint is no longer kept')
	}
	const data = await getCheckpointData(lib, checkpointId)
	if (!data) throw new Error('That checkpoint is no longer kept')
	return data
}

export function updateSession(
	lib: Library,
	id: string,
	fields: Partial<Pick<LibrarySession, 'name' | 'description' | 'color'>>,
	now = Date.now(),
): void {
	lib.store.setPartialRow('sessions', id, { ...fields, updatedAt: now })
}

/**
 * Archive a session or bring it back. Archiving the session open on this device leaves
 * the device with none (Home).
 */
export function setStatus(
	lib: Library,
	id: string,
	status: Exclude<SessionStatus, 'open'>,
	now = Date.now(),
): Promise<void> {
	lib.store.setPartialRow('sessions', id, {
		archivedAt: status === 'archived' ? now : 0,
		updatedAt: now,
	})
	return status === 'archived' ? forgetIfOpen(lib, id, now) : Promise.resolve()
}

/** Make a session the one open on this device */
export function markOpen(lib: Library, id: string, now = Date.now()): Promise<void> {
	lib.store.setPartialRow('sessions', id, { lastOpenedAt: now })
	return lib.device.set({ openSessionId: id })
}

/** Record whether the open windows are the open session's; stores nothing if unchanged */
export async function setLink(lib: Library, link: Link, now = Date.now()): Promise<void> {
	if (lib.runtime.get().link !== link) await lib.runtime.set({ link, linkAt: now })
}

/**
 * When the open session goes away (deleted, archived), the device has none (Home), and
 * whether the open windows are Home's is decided afresh, so they are never saved into
 * it unasked
 */
export async function forgetIfOpen(lib: Library, id: string, now = Date.now()): Promise<void> {
	if (getOpenSessionId(lib) !== id) return
	await lib.device.set({ openSessionId: '' })
	await setLink(lib, 'unknown', now)
}

/** Delete a session with everything it owns: its content and its checkpoints */
export async function deleteSession(lib: Library, id: string): Promise<void> {
	const contentId = getSession(lib, id)?.contentId ?? ''
	const checkpointIds = listCheckpoints(lib, id).map((c) => c.id)
	lib.store.transaction(() => {
		for (const checkpointId of checkpointIds) lib.store.delRow('checkpoints', checkpointId)
		lib.store.delRow('sessions', id)
	})
	await forgetIfOpen(lib, id)
	await releaseEntries(lib, [contentId, ...checkpointIds])
}

/** Home: where you are when no other session is open. Created on first need. */
export function ensureHome(lib: Library, now = Date.now()): string {
	if (!getSession(lib, HOME_ID)) {
		lib.store.setRow('sessions', HOME_ID, {
			name: 'Home',
			kind: 'home',
			createdAt: now,
			updatedAt: now,
			origin: 'home',
		})
	}
	return HOME_ID
}

/**
 * Write a planned migration into the library, then upgrade it like any schema 1 index.
 * Ids come from the old data, so applying it twice (two pages at once, say) writes the
 * same rows twice and nothing more. The planned open session becomes this device's.
 */
export async function applyMigration(
	lib: Library,
	result: MigrationResult,
	now = Date.now(),
): Promise<void> {
	await lib.blobs.set(
		Object.fromEntries(Object.entries(result.versions).map(([id, v]) => [id, parseVersion(v)])),
	)
	await lib.device.set({ openSessionId: result.values.openSessionId })
	lib.store.transaction(() => {
		for (const [id, session] of Object.entries(result.sessions)) {
			lib.store.setRow('sessions', id, { ...session })
		}
		for (const [id, version] of Object.entries(result.versions)) {
			const { data: _json, ...meta } = version
			lib.store.setRow('versions', id, { ...meta })
		}
		lib.store.setValues({ ...result.values, schemaVersion: 1, migratedAt: now })
	})
	await upgradeLibrary(lib)
}
