/**
 * The library: sessions and their versions.
 *
 * The index (sessions, version metadata, stashed groups) is a TinyBase MergeableStore, so
 * copies in different pages and the background worker merge instead of overwriting each
 * other. Contents (a version's tabs, a stashed group's tabs) live in `blobs`, one entry
 * each, so the index stays small.
 * The old stores are never touched and serve as the rollback copy.
 *
 * Every function takes the library first, so tests can use a fresh one.
 */
import { createMergeableStore, type MergeableStore } from 'tinybase'
import { memoryBlobs, type ContentBlobs } from './blobs'
import type { MigrationResult } from './migrate'
import {
	makePreview,
	makeVersion,
	parseVersion,
	type LibrarySession,
	type LibraryVersion,
	type SessionStatus,
	type SessionContent,
	type VersionReason,
	type SavedTab,
} from './model'
import { memoryDevice, type DeviceState, type StateStore } from './state'
import { upgradeLibrary } from './upgrade'

export const LIBRARY_STORE_ID = 'papaya-library'
/** Versions kept per session, newest first */
export const MAX_VERSIONS = 10
export const HOME_ID = 'home'

export interface Library {
	store: MergeableStore
	blobs: ContentBlobs
	/** This browser's own state, such as its open session; never synced */
	device: StateStore<DeviceState>
}

export interface SessionSummary extends LibrarySession {
	id: string
	status: SessionStatus
}

export interface VersionSummary extends Omit<LibraryVersion, 'data'> {
	id: string
}

/** A group put away inside a session: its tabs are closed and kept here */
export interface StashedGroup {
	id: string
	sessionId: string
	name: string
	color: string
	tabCount: number
	/** JSON of up to four { favIconUrl, url }, as for sessions */
	preview: string
	createdAt: number
}

/**
 * TinyBase drops cells and values a schema doesn't declare when it loads stored content,
 * so names older schemas used stay declared until the upgrade has moved them out. They
 * have no default: deleting a cell that has one only resets it.
 */
const LEGACY_SESSION_CELLS = {
	/** Schema 1 */
	status: { type: 'string' },
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
			headVersionId: { type: 'string', default: '' },
			tabCount: { type: 'number', default: 0 },
			preview: { type: 'string', default: '[]' },
			origin: { type: 'string', default: '' },
			originId: { type: 'string', default: '' },
		},
		versions: {
			sessionId: { type: 'string', default: '' },
			createdAt: { type: 'number', default: 0 },
			reason: { type: 'string', default: 'manual' },
			tabCount: { type: 'number', default: 0 },
			windowCount: { type: 'number', default: 0 },
			groupCount: { type: 'number', default: 0 },
		},
		stashed: {
			sessionId: { type: 'string', default: '' },
			name: { type: 'string', default: '' },
			color: { type: 'string', default: 'grey' },
			tabCount: { type: 'number', default: 0 },
			preview: { type: 'string', default: '[]' },
			createdAt: { type: 'number', default: 0 },
		},
	})
	store.setValuesSchema({
		...LEGACY_VALUES,
		schemaVersion: { type: 'number', default: 0 },
		migratedAt: { type: 'number', default: 0 },
	})
	return { store, blobs, device }
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

/** A session's versions without their contents, newest first */
export function listVersions(lib: Library, sessionId: string): VersionSummary[] {
	return Object.entries(lib.store.getTable('versions'))
		.filter(([, row]) => row.sessionId === sessionId)
		.map(([id, row]) => ({ id, ...row }) as VersionSummary)
		.sort((a, b) => b.createdAt - a.createdAt)
}

export function getVersionData(lib: Library, versionId: string): Promise<SessionContent | null> {
	return lib.blobs.get(versionId)
}

/** What a closed session reopens to: its newest version */
export async function getSessionData(
	lib: Library,
	sessionId: string,
): Promise<SessionContent | null> {
	const head = getSession(lib, sessionId)?.headVersionId
	return head ? getVersionData(lib, head) : null
}

/** The session this browser has open, or '' for Home */
export function getOpenSessionId(lib: Library): string {
	return lib.device.get().openSessionId
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
		headVersionId: '',
		tabCount: 0,
		preview: '[]',
		origin: '',
		originId: '',
	})
	if (data) await addVersion(lib, id, data, 'manual', now)
	return id
}

/**
 * Save a new version of a session; it becomes what the session reopens to. Only the
 * newest MAX_VERSIONS are kept. The contents are written before the index points at
 * them, so a failed write never leaves a session pointing at nothing.
 */
export async function addVersion(
	lib: Library,
	sessionId: string,
	data: SessionContent,
	reason: VersionReason,
	now = Date.now(),
): Promise<string> {
	const id = newId()
	const { data: _json, ...meta } = makeVersion(sessionId, data, reason, now)
	await lib.blobs.set({ [id]: data })
	let pruned: string[] = []
	lib.store.transaction(() => {
		lib.store.setRow('versions', id, { ...meta })
		lib.store.setPartialRow('sessions', sessionId, {
			headVersionId: id,
			tabCount: meta.tabCount,
			preview: makePreview(data),
			updatedAt: now,
		})
		pruned = listVersions(lib, sessionId)
			.slice(MAX_VERSIONS)
			.map((v) => v.id)
		for (const old of pruned) lib.store.delRow('versions', old)
	})
	await lib.blobs.delete(pruned)
	return id
}

/** Make an older version the newest again, keeping the one it replaces */
export async function restoreVersion(
	lib: Library,
	sessionId: string,
	versionId: string,
	now = Date.now(),
): Promise<string | null> {
	const data = await getVersionData(lib, versionId)
	return data ? addVersion(lib, sessionId, data, 'restore', now) : null
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
	return status === 'archived' ? forgetIfOpen(lib, id) : Promise.resolve()
}

/** Make a session the one open on this device */
export function markOpen(lib: Library, id: string, now = Date.now()): Promise<void> {
	lib.store.setPartialRow('sessions', id, { lastOpenedAt: now })
	return lib.device.set({ openSessionId: id })
}

function forgetIfOpen(lib: Library, id: string): Promise<void> {
	return getOpenSessionId(lib) === id ? lib.device.set({ openSessionId: '' }) : Promise.resolve()
}

export async function deleteSession(lib: Library, id: string): Promise<void> {
	const versionIds = listVersions(lib, id).map((v) => v.id)
	const stashIds = listStashed(lib, id).map((g) => g.id)
	lib.store.transaction(() => {
		for (const versionId of versionIds) lib.store.delRow('versions', versionId)
		for (const stashId of stashIds) lib.store.delRow('stashed', stashId)
		lib.store.delRow('sessions', id)
	})
	await forgetIfOpen(lib, id)
	await lib.blobs.delete([...versionIds, ...stashIds])
}

// ==================== Stashed groups ====================

/** A session's stashed groups, most recently stashed first; every session's without an id */
export function listStashed(lib: Library, sessionId?: string): StashedGroup[] {
	return Object.entries(lib.store.getTable('stashed'))
		.map(([id, row]) => ({ id, ...row }) as StashedGroup)
		.filter((g) => sessionId == null || g.sessionId === sessionId)
		.sort((a, b) => b.createdAt - a.createdAt)
}

export function getStashed(lib: Library, id: string): StashedGroup | null {
	const row = lib.store.getRow('stashed', id)
	return Object.keys(row).length ? ({ id, ...row } as StashedGroup) : null
}

export async function getStashedTabs(lib: Library, id: string): Promise<SavedTab[]> {
	return (await lib.blobs.get(id))?.tabs ?? []
}

/** Keep a group's tabs in a session. The tabs are written before the index lists them. */
export async function addStashed(
	lib: Library,
	sessionId: string,
	group: { name: string; color: string },
	tabs: SavedTab[],
	now = Date.now(),
): Promise<string> {
	const id = `stash-${newId()}`
	await lib.blobs.set({ [id]: { tabs, groups: [], windows: [] } })
	lib.store.setRow('stashed', id, {
		sessionId,
		name: group.name,
		color: group.color,
		tabCount: tabs.length,
		preview: makePreview({ tabs }),
		createdAt: now,
	})
	return id
}

export function updateStashed(
	lib: Library,
	id: string,
	fields: Partial<Pick<StashedGroup, 'name' | 'color' | 'sessionId'>>,
): void {
	lib.store.setPartialRow('stashed', id, fields)
}

export async function removeStashed(lib: Library, id: string): Promise<void> {
	lib.store.delRow('stashed', id)
	await lib.blobs.delete([id])
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
