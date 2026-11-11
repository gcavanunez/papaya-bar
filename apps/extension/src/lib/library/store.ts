/**
 * The library: sessions and their versions.
 *
 * The index (sessions and version metadata) is a TinyBase MergeableStore, so copies in
 * different pages and the background worker merge instead of overwriting each other.
 * Version contents live in `blobs`, one entry per version, so the index stays small.
 * The old stores are never touched and serve as the rollback copy.
 *
 * Every function takes the library first, so tests can use a fresh one.
 */
import { createMergeableStore, type MergeableStore } from 'tinybase'
import { memoryBlobs, type VersionBlobs } from './blobs'
import type { MigrationResult } from './migrate'
import {
	makePreview,
	makeVersion,
	parseVersion,
	type LibrarySession,
	type LibraryVersion,
	type SessionStatus,
	type VersionData,
	type VersionReason,
} from './model'

export const LIBRARY_STORE_ID = 'papaya-library'
export const LIBRARY_SCHEMA_VERSION = 1
/** Versions kept per session, newest first */
export const MAX_VERSIONS = 10
export const HOME_ID = 'home'

export interface Library {
	store: MergeableStore
	blobs: VersionBlobs
}

export interface SessionSummary extends LibrarySession {
	id: string
}

export interface VersionSummary extends Omit<LibraryVersion, 'data'> {
	id: string
}

export function createLibrary(blobs: VersionBlobs = memoryBlobs()): Library {
	const store = createMergeableStore(LIBRARY_STORE_ID)
	store.setTablesSchema({
		sessions: {
			name: { type: 'string', default: '' },
			description: { type: 'string', default: '' },
			color: { type: 'string', default: 'grey' },
			kind: { type: 'string', default: 'normal' },
			status: { type: 'string', default: 'closed' },
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
	})
	store.setValuesSchema({
		openSessionId: { type: 'string', default: '' },
		parkedSessionId: { type: 'string', default: '' },
		homeSessionId: { type: 'string', default: '' },
		schemaVersion: { type: 'number', default: 0 },
		migratedAt: { type: 'number', default: 0 },
	})
	return { store, blobs }
}

// ==================== Reading ====================

export function getSession(lib: Library, id: string): SessionSummary | null {
	const row = lib.store.getRow('sessions', id)
	return Object.keys(row).length ? ({ id, ...row } as SessionSummary) : null
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
		.map(([id, row]) => ({ id, ...row }) as SessionSummary)
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

export function getVersionData(lib: Library, versionId: string): Promise<VersionData | null> {
	return lib.blobs.get(versionId)
}

/** What a closed session reopens to: its newest version */
export async function getSessionData(lib: Library, sessionId: string): Promise<VersionData | null> {
	const head = getSession(lib, sessionId)?.headVersionId
	return head ? getVersionData(lib, head) : null
}

export function getOpenSessionId(lib: Library): string {
	return (lib.store.getValue('openSessionId') as string) || ''
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
	data?: VersionData,
	now = Date.now(),
): Promise<string> {
	const id = fields.id ?? newId()
	lib.store.setRow('sessions', id, {
		name: fields.name,
		description: fields.description ?? '',
		color: fields.color ?? 'grey',
		kind: fields.kind ?? 'normal',
		status: fields.status ?? 'closed',
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
	data: VersionData,
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

export function setStatus(
	lib: Library,
	id: string,
	status: Exclude<SessionStatus, 'open'>,
	now = Date.now(),
): void {
	lib.store.transaction(() => {
		lib.store.setPartialRow('sessions', id, { status, updatedAt: now })
		if (getOpenSessionId(lib) === id) lib.store.setValue('openSessionId', '')
	})
}

/** Mark a session as the open one; the previously open session becomes closed */
export function markOpen(lib: Library, id: string, now = Date.now()): void {
	lib.store.transaction(() => {
		const previous = getOpenSessionId(lib)
		if (previous && previous !== id && getSession(lib, previous)?.status === 'open') {
			lib.store.setPartialRow('sessions', previous, { status: 'closed' })
		}
		lib.store.setPartialRow('sessions', id, { status: 'open', lastOpenedAt: now })
		lib.store.setValue('openSessionId', id)
	})
}

export async function deleteSession(lib: Library, id: string): Promise<void> {
	const versionIds = listVersions(lib, id).map((v) => v.id)
	lib.store.transaction(() => {
		for (const versionId of versionIds) lib.store.delRow('versions', versionId)
		lib.store.delRow('sessions', id)
		for (const key of ['openSessionId', 'parkedSessionId', 'homeSessionId'] as const) {
			if (lib.store.getValue(key) === id) lib.store.setValue(key, '')
		}
	})
	await lib.blobs.delete(versionIds)
}

/** Home: where you are when no other session is open. Created on first need. */
export function ensureHome(lib: Library, now = Date.now()): string {
	if (!getSession(lib, HOME_ID)) {
		lib.store.setRow('sessions', HOME_ID, {
			name: 'Home',
			kind: 'home',
			status: 'closed',
			createdAt: now,
			updatedAt: now,
			origin: 'home',
		})
		lib.store.setValue('homeSessionId', HOME_ID)
	}
	return HOME_ID
}

/**
 * Write a planned migration into the library. Ids come from the old data, so applying
 * it twice (two pages at once, say) writes the same rows twice and nothing more.
 */
export async function applyMigration(
	lib: Library,
	result: MigrationResult,
	now = Date.now(),
): Promise<void> {
	await lib.blobs.set(
		Object.fromEntries(Object.entries(result.versions).map(([id, v]) => [id, parseVersion(v)])),
	)
	lib.store.transaction(() => {
		for (const [id, session] of Object.entries(result.sessions)) {
			lib.store.setRow('sessions', id, { ...session })
		}
		for (const [id, version] of Object.entries(result.versions)) {
			const { data: _json, ...meta } = version
			lib.store.setRow('versions', id, { ...meta })
		}
		lib.store.setValues({
			...result.values,
			schemaVersion: LIBRARY_SCHEMA_VERSION,
			migratedAt: now,
		})
	})
}
