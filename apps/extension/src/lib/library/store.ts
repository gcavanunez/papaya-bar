/**
 * The library store: sessions and their versions, in their own TinyBase store so the
 * old one stays untouched until the switch-over (and serves as the rollback copy).
 *
 * Every function takes the store as its first argument, so tests can use a fresh one.
 * Persistence and the switch-over live with the code that opens the store.
 */
import { createMergeableStore, type MergeableStore } from 'tinybase'
import type { MigrationResult } from './migrate'
import {
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

export function createLibraryStore(): MergeableStore {
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
			data: { type: 'string', default: '{"tabs":[],"groups":[],"windows":[]}' },
		},
	})
	store.setValuesSchema({
		openSessionId: { type: 'string', default: '' },
		parkedSessionId: { type: 'string', default: '' },
		homeSessionId: { type: 'string', default: '' },
		schemaVersion: { type: 'number', default: 0 },
		migratedAt: { type: 'number', default: 0 },
	})
	return store
}

export interface SessionSummary extends LibrarySession {
	id: string
}

export interface VersionSummary extends Omit<LibraryVersion, 'data'> {
	id: string
}

// ==================== Reading ====================

export function getSession(store: MergeableStore, id: string): SessionSummary | null {
	const row = store.getRow('sessions', id)
	return Object.keys(row).length ? ({ id, ...row } as SessionSummary) : null
}

/** Sessions without their contents, most recently used first */
export function listSessions(
	store: MergeableStore,
	filter: { status?: SessionStatus | SessionStatus[] } = {},
): SessionSummary[] {
	const statuses = filter.status == null ? null : [filter.status].flat()
	return Object.entries(store.getTable('sessions'))
		.map(([id, row]) => ({ id, ...row }) as SessionSummary)
		.filter((s) => !statuses || statuses.includes(s.status))
		.sort(
			(a, b) => Math.max(b.lastOpenedAt, b.updatedAt) - Math.max(a.lastOpenedAt, a.updatedAt),
		)
}

/** A session's versions without their contents, newest first */
export function listVersions(store: MergeableStore, sessionId: string): VersionSummary[] {
	return Object.entries(store.getTable('versions'))
		.filter(([, row]) => row.sessionId === sessionId)
		.map(([id, row]) => {
			const { data: _data, ...rest } = row as unknown as LibraryVersion
			return { id, ...rest }
		})
		.sort((a, b) => b.createdAt - a.createdAt)
}

export function getVersionData(store: MergeableStore, versionId: string): VersionData | null {
	const data = store.getCell('versions', versionId, 'data')
	return typeof data === 'string' ? parseVersion({ data }) : null
}

/** What a closed session reopens to: its newest version */
export function getSessionData(store: MergeableStore, sessionId: string): VersionData | null {
	const head = store.getCell('sessions', sessionId, 'headVersionId')
	return typeof head === 'string' && head ? getVersionData(store, head) : null
}

export function getOpenSessionId(store: MergeableStore): string {
	return (store.getValue('openSessionId') as string) || ''
}

// ==================== Writing ====================

const newId = () => crypto.randomUUID()

export function createSession(
	store: MergeableStore,
	fields: { name: string; description?: string; color?: string; status?: SessionStatus },
	data?: VersionData,
	now = Date.now(),
): string {
	const id = newId()
	store.transaction(() => {
		store.setRow('sessions', id, {
			name: fields.name,
			description: fields.description ?? '',
			color: fields.color ?? 'grey',
			kind: 'normal',
			status: fields.status ?? 'closed',
			createdAt: now,
			updatedAt: now,
			lastOpenedAt: 0,
			headVersionId: '',
			tabCount: 0,
			origin: '',
			originId: '',
		})
		if (data) addVersion(store, id, data, 'manual', now)
	})
	return id
}

/**
 * Save a new version of a session; it becomes what the session reopens to. Only the
 * newest MAX_VERSIONS are kept.
 */
export function addVersion(
	store: MergeableStore,
	sessionId: string,
	data: VersionData,
	reason: VersionReason,
	now = Date.now(),
): string {
	const id = newId()
	store.transaction(() => {
		const version = makeVersion(sessionId, data, reason, now)
		store.setRow('versions', id, { ...version })
		store.setPartialRow('sessions', sessionId, {
			headVersionId: id,
			tabCount: version.tabCount,
			updatedAt: now,
		})
		for (const old of listVersions(store, sessionId).slice(MAX_VERSIONS)) {
			store.delRow('versions', old.id)
		}
	})
	return id
}

/** Make an older version the newest again, keeping the one it replaces */
export function restoreVersion(
	store: MergeableStore,
	sessionId: string,
	versionId: string,
	now = Date.now(),
): string | null {
	const data = getVersionData(store, versionId)
	return data ? addVersion(store, sessionId, data, 'manual', now) : null
}

export function updateSession(
	store: MergeableStore,
	id: string,
	fields: Partial<Pick<LibrarySession, 'name' | 'description' | 'color'>>,
	now = Date.now(),
): void {
	store.setPartialRow('sessions', id, { ...fields, updatedAt: now })
}

export function setStatus(
	store: MergeableStore,
	id: string,
	status: Exclude<SessionStatus, 'open'>,
	now = Date.now(),
): void {
	store.setPartialRow('sessions', id, { status, updatedAt: now })
	if (getOpenSessionId(store) === id) store.setValue('openSessionId', '')
}

/** Mark a session as the open one; the previously open session becomes closed */
export function markOpen(store: MergeableStore, id: string, now = Date.now()): void {
	store.transaction(() => {
		const previous = getOpenSessionId(store)
		if (previous && previous !== id)
			store.setPartialRow('sessions', previous, { status: 'closed' })
		store.setPartialRow('sessions', id, { status: 'open', lastOpenedAt: now })
		store.setValue('openSessionId', id)
	})
}

export function deleteSession(store: MergeableStore, id: string): void {
	store.transaction(() => {
		for (const version of listVersions(store, id)) store.delRow('versions', version.id)
		store.delRow('sessions', id)
		for (const key of ['openSessionId', 'parkedSessionId', 'homeSessionId'] as const) {
			if (store.getValue(key) === id) store.setValue(key, '')
		}
	})
}

/** Write a planned migration into an empty library store */
export function applyMigration(
	store: MergeableStore,
	result: MigrationResult,
	now = Date.now(),
): void {
	if (Object.keys(store.getTable('sessions')).length) {
		throw new Error('The library already has sessions; migrate into an empty store')
	}
	store.transaction(() => {
		for (const [id, session] of Object.entries(result.sessions)) {
			store.setRow('sessions', id, { ...session })
		}
		for (const [id, version] of Object.entries(result.versions)) {
			store.setRow('versions', id, { ...version })
		}
		store.setValues({
			...result.values,
			schemaVersion: LIBRARY_SCHEMA_VERSION,
			migratedAt: now,
		})
	})
}
