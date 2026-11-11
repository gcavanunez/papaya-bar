/**
 * TinyBase Store Configuration
 *
 * Sets up a MergeableStore with CRDT support for conflict-free sync.
 * Includes LocalPersister for offline support.
 * Remote sync via PartyKit WebSocket is gated on authentication.
 *
 * Tables:
 * - sessions: Saved browser sessions
 * - tabs: Individual tabs within sessions
 * - groups: Tab groups within sessions
 * - windows: Window positions/sizes within sessions
 */

import { createMergeableStore, type MergeableStore, type Content } from 'tinybase'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import {
	createIndexedDbPersister,
	type IndexedDbPersister,
} from 'tinybase/persisters/persister-indexed-db'
import PartySocket from 'partysocket'
import type { SaveableTab } from '@/types'
import type { SavedWindow, SavedDisplay } from '@/types'

// ==================== Saved Group Type ====================

/**
 * Group data as stored in TinyBase
 * Subset of chrome.tabGroups.TabGroup with only persistable fields
 */
export interface SavedGroup {
	id: number
	title?: string
	color: chrome.tabGroups.Color
	collapsed: boolean
	windowId: number
}

// ==================== Configuration ====================

const STORE_ID = 'papaya-sessions'
const LOCAL_STORAGE_KEY = 'papaya:sessions:store'
const INDEXED_DB_NAME = 'papaya-sessions'

// ==================== Types ====================

// Session stored in TinyBase
export interface StoredSession {
	id: string
	title: string
	description: string
	createdAt: number
	updatedAt: number
	contextId: string
	reason: SessionReason
}

export type SessionReason = 'manual' | 'head' | 'snapshot'
export type ContextStatus = 'active' | 'stashed' | 'archived'

// Context (living bucket) stored in TinyBase
export interface StoredContext {
	id: string
	name: string
	color: string
	icon: string
	status: ContextStatus
	headSessionId: string
	createdAt: number
	updatedAt: number
	sortOrder: number
}

// A context assembled together with its current tab set
export interface AssembledContext extends StoredContext {
	tabCount: number
	session: AssembledSession | null
}

// Tab stored in TinyBase
export interface StoredTab {
	sessionId: string
	stableId: string
	url: string
	title: string
	favIconUrl: string
	windowId: number
	groupId: number
	active: boolean
	index: number
}

// Group stored in TinyBase
export interface StoredGroup {
	sessionId: string
	originalId: number
	title: string
	color: string
	collapsed: boolean
	windowId: number
}

// Window stored in TinyBase
export interface StoredWindow {
	sessionId: string
	originalId: number
	width: number
	height: number
	left: number
	top: number
}

// Assembled session data (matching SavedData format)
export interface AssembledSession {
	id: string
	title: string
	description: string
	createdAt: number
	updatedAt: number
	tabs: SaveableTab[]
	groups: SavedGroup[]
	windows: SavedWindow[]
	displays: SavedDisplay[] // Not stored - captured at restore time
}

// ==================== Store Instance ====================

/**
 * The singleton MergeableStore instance
 * CRDT-enabled for conflict-free merging
 */
export const store: MergeableStore = createMergeableStore(STORE_ID)

// ==================== Schema Definition ====================

/**
 * Define the schema for all tables
 * This provides type safety and default values
 */
store.setTablesSchema({
	contexts: {
		name: { type: 'string', default: '' },
		color: { type: 'string', default: 'grey' },
		icon: { type: 'string', default: '' },
		// 'active' | 'stashed' | 'archived'
		status: { type: 'string', default: 'stashed' },
		// Points at the `sessions` row holding this context's current tab set.
		headSessionId: { type: 'string', default: '' },
		createdAt: { type: 'number' },
		updatedAt: { type: 'number' },
		sortOrder: { type: 'number', default: 0 },
	},
	sessions: {
		title: { type: 'string', default: '' },
		description: { type: 'string', default: '' },
		createdAt: { type: 'number' },
		updatedAt: { type: 'number' },
		// '' for standalone saved sessions; otherwise the owning context id.
		contextId: { type: 'string', default: '' },
		// 'manual' | 'head' | 'snapshot'
		reason: { type: 'string', default: 'manual' },
	},
	tabs: {
		sessionId: { type: 'string' },
		stableId: { type: 'string', default: '' },
		url: { type: 'string', default: '' },
		title: { type: 'string', default: '' },
		favIconUrl: { type: 'string', default: '' },
		windowId: { type: 'number', default: 0 },
		groupId: { type: 'number', default: -1 },
		active: { type: 'boolean', default: false },
		index: { type: 'number', default: 0 },
	},
	groups: {
		sessionId: { type: 'string' },
		originalId: { type: 'number', default: 0 },
		title: { type: 'string', default: '' },
		color: { type: 'string', default: 'grey' },
		collapsed: { type: 'boolean', default: false },
		windowId: { type: 'number', default: 0 },
	},
	windows: {
		sessionId: { type: 'string' },
		originalId: { type: 'number', default: 0 },
		width: { type: 'number', default: 0 },
		height: { type: 'number', default: 0 },
		left: { type: 'number', default: 0 },
		top: { type: 'number', default: 0 },
	},
})

/**
 * Store-level values (not tied to a table row).
 * - activeContextId: the context currently "checked out" into the live browser.
 *   '' means no active context (you're in the Inbox).
 */
store.setValuesSchema({
	activeContextId: { type: 'string', default: '' },
	// The dedicated "Parked" context that stale auto-parked tabs land in ('' until created).
	parkedContextId: { type: 'string', default: '' },
})

// ==================== Persistence ====================

let localPersister: IndexedDbPersister | null = null
let isInitialized = false

/**
 * Initialize the store with IndexedDB persistence.
 *
 * IndexedDB is covered by the `unlimitedStorage` permission (localStorage is
 * NOT — it caps at ~5MB), so heavy users with many sessions/contexts no longer
 * hit QuotaExceededError. On first run after upgrading, data is migrated out of
 * the old localStorage store and the localStorage copy is freed.
 */
export async function initializeStore(): Promise<void> {
	if (isInitialized) return

	// IndexedDB persistence (poll every 1s for cross-document changes).
	localPersister = createIndexedDbPersister(store, INDEXED_DB_NAME, 1)
	await localPersister.startAutoLoad()

	// One-time migration: pull any pre-existing localStorage store into IndexedDB.
	await migrateStoreToIndexedDb()

	await localPersister.startAutoSave()

	isInitialized = true

	// Run one-time migration from the oldest localStorage format
	migrateFromLegacyStorage()
}

/**
 * Move the legacy localStorage-backed TinyBase store into IndexedDB once, then
 * delete the localStorage copy to reclaim its space.
 */
async function migrateStoreToIndexedDb(): Promise<void> {
	const hasLegacy =
		typeof localStorage !== 'undefined' && localStorage.getItem(LOCAL_STORAGE_KEY) !== null
	if (!hasLegacy) return

	const idbEmpty =
		Object.keys(store.getTable('sessions')).length === 0 &&
		Object.keys(store.getTable('contexts')).length === 0

	try {
		if (idbEmpty) {
			// Load the old localStorage content into the store, then persist to IDB.
			const legacy = createLocalPersister(store, LOCAL_STORAGE_KEY)
			await legacy.load()
			await legacy.destroy()
			await localPersister?.save()
		}
		// Either we just migrated, or IDB already had data — free the localStorage copy.
		localStorage.removeItem(LOCAL_STORAGE_KEY)
		console.log('[migration] Moved TinyBase store from localStorage to IndexedDB')
	} catch (e) {
		console.error('[migration] Failed to migrate store to IndexedDB:', e)
	}
}

/**
 * Check if store is initialized
 */
export function isStoreInitialized(): boolean {
	return isInitialized
}

// ==================== Legacy Migration / Import ====================

const MIGRATION_KEY = 'papaya:migration:legacy-done'

/**
 * Build a fingerprint for a session to detect duplicates.
 * Uses title + tab count since legacy sessions don't share IDs with TinyBase.
 */
function sessionFingerprint(title: string, tabCount: number): string {
	return `${title.trim().toLowerCase()}::${tabCount}`
}

/**
 * Collect fingerprints of all sessions currently in TinyBase.
 */
function getExistingFingerprints(): Set<string> {
	const sessionsTable = store.getTable('sessions')
	const tabsTable = store.getTable('tabs')
	const fps = new Set<string>()

	for (const sessionId of Object.keys(sessionsTable)) {
		const session = sessionsTable[sessionId]
		const tabCount = Object.values(tabsTable).filter((t) => t.sessionId === sessionId).length
		fps.add(sessionFingerprint(session.title as string, tabCount))
	}

	return fps
}

/**
 * Import a single legacy session into TinyBase.
 * Returns the new session ID if imported, null if skipped.
 */
function importLegacySession(dateKey: string, session: LegacySavedData): string | null {
	if (!session || !session.tabs || session.tabs.length === 0) return null

	// Parse the date key (format: "hh:mm aaa MM/dd/yyyy")
	let createdAt: number
	try {
		createdAt = new Date(dateKey).getTime()
		if (isNaN(createdAt)) createdAt = Date.now()
	} catch {
		createdAt = Date.now()
	}

	const sessionId = crypto.randomUUID()
	const now = Date.now()

	store.setRow('sessions', sessionId, {
		title: session.title || '',
		description: session.description || '',
		createdAt,
		updatedAt: now,
	})

	session.tabs.forEach((tab, index) => {
		const tabId = `${sessionId}-tab-${tab.stableId || index}`
		store.setRow('tabs', tabId, {
			sessionId,
			stableId: tab.stableId || '',
			url: tab.url || '',
			title: tab.title || '',
			favIconUrl: tab.favIconUrl || '',
			windowId: tab.windowId || 0,
			groupId: tab.groupId ?? -1,
			active: tab.active || false,
			index,
		})
	})

	if (session.groups) {
		session.groups.forEach((group) => {
			const groupRowId = `${sessionId}-group-${group.id}`
			store.setRow('groups', groupRowId, {
				sessionId,
				originalId: group.id,
				title: group.title || '',
				color: group.color || 'grey',
				collapsed: group.collapsed || false,
				windowId: group.windowId || 0,
			})
		})
	}

	if (session.windows) {
		session.windows.forEach((win) => {
			if (win.id !== undefined) {
				const winRowId = `${sessionId}-win-${win.id}`
				store.setRow('windows', winRowId, {
					sessionId,
					originalId: win.id,
					width: win.width || 0,
					height: win.height || 0,
					left: win.left || 0,
					top: win.top || 0,
				})
			}
		})
	}

	return sessionId
}

/**
 * Parse the raw `sessions:saved` localStorage value into entries.
 */
function parseLegacyEntries(): Array<[string, LegacySavedData]> {
	const raw = localStorage.getItem('sessions:saved')
	if (!raw) return []

	const parsed = JSON.parse(raw) as
		| Array<[string, LegacySavedData]>
		| Record<string, LegacySavedData>

	return Array.isArray(parsed) ? parsed : Object.entries(parsed)
}

/**
 * One-time auto-migration at startup: import any legacy sessions that
 * aren't already in TinyBase. Merges rather than skipping wholesale.
 */
function migrateFromLegacyStorage(): void {
	if (localStorage.getItem(MIGRATION_KEY)) return

	try {
		const entries = parseLegacyEntries()
		if (entries.length === 0) {
			localStorage.setItem(MIGRATION_KEY, 'true')
			return
		}

		const existing = getExistingFingerprints()
		let migrated = 0

		for (const [dateKey, session] of entries) {
			if (!session || !session.tabs) continue
			const fp = sessionFingerprint(session.title || '', session.tabs.length)
			if (existing.has(fp)) continue // already in TinyBase

			if (importLegacySession(dateKey, session)) {
				existing.add(fp) // prevent dupe within same batch
				migrated++
			}
		}

		console.log(`[migration] Migrated ${migrated} legacy sessions to TinyBase`)
		localStorage.setItem(MIGRATION_KEY, 'true')
	} catch (e) {
		console.error('[migration] Failed to migrate legacy sessions:', e)
	}
}

/**
 * Manually import all legacy sessions that aren't already in TinyBase.
 * Can be called from the UI to force-sync older data.
 *
 * @returns Number of sessions imported
 */
export function importLegacySessions(): number {
	try {
		const entries = parseLegacyEntries()
		if (entries.length === 0) return 0

		const existing = getExistingFingerprints()
		let imported = 0

		for (const [dateKey, session] of entries) {
			if (!session || !session.tabs) continue
			const fp = sessionFingerprint(session.title || '', session.tabs.length)
			if (existing.has(fp)) continue

			if (importLegacySession(dateKey, session)) {
				existing.add(fp)
				imported++
			}
		}

		console.log(`[importLegacySessions] Imported ${imported} legacy sessions`)
		return imported
	} catch (e) {
		console.error('[importLegacySessions] Failed:', e)
		return 0
	}
}

interface LegacySavedData {
	title: string
	description: string
	tabs: Array<{
		stableId?: string
		url?: string
		title?: string
		favIconUrl?: string
		windowId?: number
		groupId?: number
		active?: boolean
		id?: number
	}>
	groups?: Array<{
		id: number
		title?: string
		color: string
		collapsed: boolean
		windowId: number
	}>
	windows?: Array<{
		id?: number
		width?: number
		height?: number
		left?: number
		top?: number
	}>
	displays?: Array<{
		height: number
		left: number
		top: number
		width: number
	}>
}

/**
 * Force save to localStorage (useful before page unload)
 */
export async function saveStore(): Promise<void> {
	if (localPersister) {
		await localPersister.save()
	}
}

/**
 * Get the raw store content (for debugging)
 */
export function getStoreContent(): Content {
	return store.getContent()
}

// ==================== Session Operations ====================

/**
 * Create a new session with tabs, groups, and windows
 * Accepts either chrome.tabGroups.TabGroup[] or SavedGroup[] for groups
 */
export function createSession(data: {
	title: string
	description: string
	tabs: SaveableTab[]
	groups: SavedGroup[] | chrome.tabGroups.TabGroup[]
	windows: SavedWindow[]
	contextId?: string
	reason?: SessionReason
}): string {
	const sessionId = crypto.randomUUID()
	const now = Date.now()

	// Create session row
	store.setRow('sessions', sessionId, {
		title: data.title,
		description: data.description,
		createdAt: now,
		updatedAt: now,
		contextId: data.contextId ?? '',
		reason: data.reason ?? 'manual',
	})

	// Create tabs
	data.tabs.forEach((tab, index) => {
		const tabId = `${sessionId}-tab-${tab.stableId || index}`
		store.setRow('tabs', tabId, {
			sessionId,
			stableId: tab.stableId,
			url: tab.url || '',
			title: tab.title || '',
			favIconUrl: tab.favIconUrl || '',
			windowId: tab.windowId,
			groupId: tab.groupId ?? -1,
			active: tab.active,
			index,
		})
	})

	// Create groups
	data.groups.forEach((group) => {
		const groupRowId = `${sessionId}-group-${group.id}`
		store.setRow('groups', groupRowId, {
			sessionId,
			originalId: group.id,
			title: group.title || '',
			color: group.color,
			collapsed: group.collapsed,
			windowId: group.windowId,
		})
	})

	// Create windows
	data.windows.forEach((win) => {
		if (win.id !== undefined) {
			const winRowId = `${sessionId}-win-${win.id}`
			store.setRow('windows', winRowId, {
				sessionId,
				originalId: win.id,
				width: win.width || 0,
				height: win.height || 0,
				left: win.left || 0,
				top: win.top || 0,
			})
		}
	})

	return sessionId
}

/**
 * Update session metadata
 */
export function updateSession(
	sessionId: string,
	data: Partial<{ title: string; description: string }>,
): void {
	if (data.title !== undefined) {
		store.setCell('sessions', sessionId, 'title', data.title)
	}
	if (data.description !== undefined) {
		store.setCell('sessions', sessionId, 'description', data.description)
	}
	store.setCell('sessions', sessionId, 'updatedAt', Date.now())
}

/**
 * Delete a session and all its related data
 */
export function deleteSession(sessionId: string): void {
	// Delete related tabs
	const tabsTable = store.getTable('tabs')
	Object.keys(tabsTable).forEach((tabId) => {
		if (store.getCell('tabs', tabId, 'sessionId') === sessionId) {
			store.delRow('tabs', tabId)
		}
	})

	// Delete related groups
	const groupsTable = store.getTable('groups')
	Object.keys(groupsTable).forEach((groupId) => {
		if (store.getCell('groups', groupId, 'sessionId') === sessionId) {
			store.delRow('groups', groupId)
		}
	})

	// Delete related windows
	const windowsTable = store.getTable('windows')
	Object.keys(windowsTable).forEach((winId) => {
		if (store.getCell('windows', winId, 'sessionId') === sessionId) {
			store.delRow('windows', winId)
		}
	})

	// Delete session
	store.delRow('sessions', sessionId)
}

/**
 * Get a single session by ID (assembled with all related data)
 */
export function getSession(sessionId: string): AssembledSession | null {
	const session = store.getRow('sessions', sessionId)
	if (!session || Object.keys(session).length === 0) return null

	return assembleSession(sessionId, session as Record<string, string | number | boolean>)
}

/**
 * Get all sessions (assembled with all related data)
 */
export function getAllSessions(): AssembledSession[] {
	const sessionsTable = store.getTable('sessions')

	return Object.entries(sessionsTable)
		.filter(([, session]) => !session.contextId) // exclude context heads/snapshots
		.map(([id, session]) =>
			assembleSession(id, session as Record<string, string | number | boolean>),
		)
		.sort((a, b) => b.updatedAt - a.updatedAt) // Most recent first
}

/**
 * Assemble a session with its related tabs, groups, and windows
 */
function assembleSession(
	sessionId: string,
	session: Record<string, string | number | boolean>,
): AssembledSession {
	const tabsTable = store.getTable('tabs')
	const groupsTable = store.getTable('groups')
	const windowsTable = store.getTable('windows')

	// Get tabs for this session
	const tabs: SaveableTab[] = Object.entries(tabsTable)
		.filter(([, tab]) => tab.sessionId === sessionId)
		.map(([, tab]) => ({
			stableId: tab.stableId as string,
			url: tab.url as string,
			title: tab.title as string,
			favIconUrl: tab.favIconUrl as string,
			windowId: tab.windowId as number,
			groupId: tab.groupId as number,
			active: tab.active as boolean,
			id: undefined, // Original ID is not preserved
		}))
		.sort((a, b) => {
			// Sort by index
			const aIndex =
				(store.getCell('tabs', `${sessionId}-tab-${a.stableId}`, 'index') as number) || 0
			const bIndex =
				(store.getCell('tabs', `${sessionId}-tab-${b.stableId}`, 'index') as number) || 0
			return aIndex - bIndex
		})

	// Get groups for this session
	const groups: SavedGroup[] = Object.entries(groupsTable)
		.filter(([, group]) => group.sessionId === sessionId)
		.map(([, group]) => ({
			id: group.originalId as number,
			title: (group.title as string) || undefined,
			color: group.color as chrome.tabGroups.Color,
			collapsed: group.collapsed as boolean,
			windowId: group.windowId as number,
		}))

	// Get windows for this session
	const windows: SavedWindow[] = Object.entries(windowsTable)
		.filter(([, win]) => win.sessionId === sessionId)
		.map(([, win]) => ({
			id: win.originalId as number,
			width: win.width as number,
			height: win.height as number,
			left: win.left as number,
			top: win.top as number,
		}))

	return {
		id: sessionId,
		title: session.title as string,
		description: session.description as string,
		createdAt: session.createdAt as number,
		updatedAt: session.updatedAt as number,
		tabs,
		groups,
		windows,
		displays: [], // Displays are captured at restore time, not stored
	}
}

// ==================== Store Listeners ====================

/**
 * Add a listener for context table or active-context changes.
 * Returns a function to remove the listener.
 */
export function addContextsListener(callback: () => void): () => void {
	// Contexts are assembled from the contexts + sessions + tabs tables, and the
	// active pointer is a store value, so listen to all of them.
	const tablesListenerId = store.addTablesListener(callback)
	const valueListenerId = store.addValueListener('activeContextId', callback)
	return () => {
		store.delListener(tablesListenerId)
		store.delListener(valueListenerId)
	}
}

/**
 * Add a listener for any table changes
 * Returns a function to remove the listener
 */
export function addTablesListener(callback: () => void): () => void {
	const listenerId = store.addTablesListener(callback)
	return () => store.delListener(listenerId)
}

/**
 * Add a listener for session table changes only
 */
export function addSessionsListener(callback: () => void): () => void {
	const listenerId = store.addTableListener('sessions', callback)
	return () => store.delListener(listenerId)
}

// ==================== Remote Sync ====================

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

let syncSocket: PartySocket | null = null
let currentSyncStatus: SyncStatus = 'disconnected'
const syncListeners = new Set<(status: SyncStatus) => void>()
let syncTablesListenerId: string | null = null
let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null
let currentToken = ''
let currentUserId = ''
// Suppresses the push that a pull-merge would otherwise trigger via the listener.
let applyingRemote = false

function setSyncStatus(status: SyncStatus) {
	currentSyncStatus = status
	syncListeners.forEach((listener) => listener(status))
}

type RemoteTables = Record<string, Record<string, Record<string, unknown>>>

/**
 * Merge a remote snapshot into the local store.
 *
 * Conservative + non-destructive: missing rows are added; rows that carry an
 * `updatedAt` use newer-wins; rows without one (tabs/groups/windows) are only
 * added if absent so local edits are never clobbered. (Full CRDT delete
 * propagation is the eventual WsSynchronizer upgrade — see plans/.)
 */
function mergeRemoteTables(tables: RemoteTables): void {
	applyingRemote = true
	try {
		store.transaction(() => {
			for (const [tableId, rows] of Object.entries(tables)) {
				for (const [rowId, remoteRow] of Object.entries(rows)) {
					const localRow = store.getRow(tableId, rowId)
					const hasLocal = localRow && Object.keys(localRow).length > 0
					if (!hasLocal) {
						store.setRow(tableId, rowId, remoteRow as Record<string, string | number | boolean>)
						continue
					}
					const localUpdated = (localRow.updatedAt as number) ?? 0
					const remoteUpdated = (remoteRow.updatedAt as number) ?? 0
					if (remoteUpdated > localUpdated) {
						store.setRow(tableId, rowId, remoteRow as Record<string, string | number | boolean>)
					}
				}
			}
		})
	} finally {
		applyingRemote = false
	}
}

/** Pull the latest server snapshot and merge it into the local store. */
async function pullAndMerge(): Promise<void> {
	if (!currentToken || !currentUserId) return
	const proto = PARTYKIT_HOST.includes('localhost') ? 'http' : 'https'
	try {
		const res = await fetch(
			`${proto}://${PARTYKIT_HOST}/parties/main/${currentUserId}/store-data`,
			{ headers: { Authorization: `Bearer ${currentToken}` } },
		)
		if (!res.ok) return
		const data = (await res.json()) as { tables?: RemoteTables }
		if (data.tables) mergeRemoteTables(data.tables)
	} catch (e) {
		console.error('[sync] pull failed:', e)
	}
}

/**
 * Push the current store tables to the server via WebSocket.
 */
function pushStoreData(): void {
	if (!syncSocket || currentSyncStatus !== 'connected') return

	const tables = store.getTables()
	syncSocket.send(
		JSON.stringify({
			type: 'store:push',
			tables,
		}),
	)
}

/**
 * Debounced version of pushStoreData to avoid flooding the server
 * on rapid consecutive changes (e.g. bulk tab save).
 */
function debouncedPushStoreData(): void {
	if (pushDebounceTimer) clearTimeout(pushDebounceTimer)
	pushDebounceTimer = setTimeout(pushStoreData, 500)
}

/**
 * Start remote sync via PartyKit WebSocket.
 * Only call this when the user is authenticated.
 *
 * @param token - Valid session token from auth
 * @param userId - Authenticated user's ID (used as room ID for data isolation)
 */
export function startRemoteSync(token: string, userId: string): void {
	if (syncSocket) return // Already connected or connecting

	currentToken = token
	currentUserId = userId
	setSyncStatus('connecting')

	syncSocket = new PartySocket({
		host: PARTYKIT_HOST,
		room: userId,
		query: { token },
	})

	syncSocket.addEventListener('message', (event) => {
		try {
			const data = JSON.parse(event.data as string) as { type: string; message?: string }
			if (data.type === 'sync:connected') {
				setSyncStatus('connected')
				// Pull remote first (merge), then push the merged local state up.
				void pullAndMerge().finally(() => pushStoreData())
			} else if (data.type === 'store:updated') {
				// Another device changed data — pull and merge it in.
				void pullAndMerge()
			} else if (data.type === 'error') {
				console.error('[sync] Server error:', data.message)
				setSyncStatus('error')
				// Server rejected us - don't let PartySocket reconnect
				syncSocket?.close()
				syncSocket = null
			}
		} catch {
			// Non-JSON message - future TinyBase sync protocol
		}
	})

	syncSocket.addEventListener('close', () => {
		syncSocket = null
		setSyncStatus('disconnected')
		// Remove store change listener
		if (syncTablesListenerId !== null) {
			store.delListener(syncTablesListenerId)
			syncTablesListenerId = null
		}
	})

	syncSocket.addEventListener('error', () => {
		setSyncStatus('error')
	})

	// Listen for local store changes and push to server (skip changes we just
	// merged in from the server to avoid a push/pull echo loop).
	syncTablesListenerId = store.addTablesListener(() => {
		if (currentSyncStatus === 'connected' && !applyingRemote) {
			debouncedPushStoreData()
		}
	})
}

/**
 * Stop remote sync and disconnect from PartyKit.
 * Call this when the user logs out.
 */
export function stopRemoteSync(): void {
	if (syncTablesListenerId !== null) {
		store.delListener(syncTablesListenerId)
		syncTablesListenerId = null
	}
	if (pushDebounceTimer) {
		clearTimeout(pushDebounceTimer)
		pushDebounceTimer = null
	}
	if (syncSocket) {
		syncSocket.close()
		syncSocket = null
	}
	currentToken = ''
	currentUserId = ''
	setSyncStatus('disconnected')
}

/**
 * Get the current sync connection status
 */
export function getSyncStatus(): SyncStatus {
	return currentSyncStatus
}

/**
 * Subscribe to sync status changes.
 * Immediately calls the listener with the current status.
 *
 * @returns Unsubscribe function
 */
export function onSyncStatusChange(listener: (status: SyncStatus) => void): () => void {
	syncListeners.add(listener)
	listener(currentSyncStatus)
	return () => syncListeners.delete(listener)
}

// ==================== Export for sync module ====================

export { store as tinybaseStore }
