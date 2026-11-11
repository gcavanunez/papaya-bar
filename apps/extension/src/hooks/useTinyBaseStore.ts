/**
 * Vue Composable for TinyBase Store
 *
 * Provides reactive access to the TinyBase MergeableStore.
 * Integrates with Vue's reactivity system for automatic UI updates.
 *
 * Features:
 * - Reactive sessions list
 * - CRUD operations for sessions
 * - Automatic store initialization
 * - Auth state integration (for future sync)
 */

import { ref, computed, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'
import {
	initializeStore,
	isStoreInitialized,
	getAllSessions,
	getSession,
	createSession,
	updateSession,
	deleteSession,
	addTablesListener,
	startRemoteSync,
	stopRemoteSync,
	onSyncStatusChange,
	importLegacySessions,
	type AssembledSession,
	type SavedGroup,
	type SyncStatus,
} from '@/sync/store'
import { getCurrentUser, isAuthenticated, onAuthStateChange, type AuthUser } from '@/sync/auth'
import type { SaveableTab } from '@/types'
import type { SavedWindow } from '@/types'

// ==================== Types ====================

export interface CreateSessionData {
	title: string
	description: string
	tabs: SaveableTab[]
	groups: SavedGroup[] | chrome.tabGroups.TabGroup[]
	windows: SavedWindow[]
}

export interface UseTinyBaseStoreReturn {
	// State
	sessions: ComputedRef<AssembledSession[]>
	isInitialized: Ref<boolean>
	isLoading: Ref<boolean>
	error: Ref<Error | null>

	// Auth state
	user: Ref<AuthUser | null>
	isLoggedIn: ComputedRef<boolean>

	// Sync state (only active when authenticated)
	syncStatus: Ref<SyncStatus>
	isSyncing: ComputedRef<boolean>

	// Actions
	createSession: (data: CreateSessionData) => string
	updateSession: (
		sessionId: string,
		data: Partial<{ title: string; description: string }>,
	) => void
	deleteSession: (sessionId: string) => void
	getSession: (sessionId: string) => AssembledSession | null
	refreshSessions: () => void
	importLegacySessions: () => number
}

// ==================== Composable ====================

/**
 * Vue composable for accessing and managing TinyBase store
 *
 * @example
 * ```vue
 * <script setup>
 * import { useTinyBaseStore } from '@/hooks/useTinyBaseStore'
 *
 * const { sessions, createSession, deleteSession, isInitialized } = useTinyBaseStore()
 *
 * // Sessions is reactive - updates automatically when store changes
 * console.log(sessions.value)
 *
 * // Create a new session
 * const sessionId = createSession({
 *   title: 'My Session',
 *   description: 'Work tabs',
 *   tabs: [...],
 *   groups: [...],
 *   windows: [...]
 * })
 * </script>
 * ```
 */
export function useTinyBaseStore(): UseTinyBaseStoreReturn {
	// ==================== Reactive State ====================

	const isInitialized = ref(false)
	const isLoading = ref(true)
	const error = ref<Error | null>(null)
	const sessionsData = ref<AssembledSession[]>([])
	const user = ref<AuthUser | null>(null)
	const syncStatus = ref<SyncStatus>('disconnected')

	// ==================== Computed Properties ====================

	const sessions = computed(() => sessionsData.value)
	const isLoggedIn = computed(() => user.value !== null)
	const isSyncing = computed(() => syncStatus.value === 'connected')

	// ==================== Internal Methods ====================

	/**
	 * Refresh sessions from store
	 */
	function refreshSessions(): void {
		try {
			sessionsData.value = getAllSessions()
		} catch (e) {
			console.error('Failed to refresh sessions:', e)
			error.value = e instanceof Error ? e : new Error('Failed to refresh sessions')
		}
	}

	/**
	 * Initialize the store and set up listeners
	 */
	async function initialize(): Promise<void> {
		try {
			isLoading.value = true
			error.value = null

			// Initialize store if not already done
			if (!isStoreInitialized()) {
				await initializeStore()
			}

			isInitialized.value = true

			// Load initial data
			refreshSessions()

			// Check auth state
			if (await isAuthenticated()) {
				user.value = await getCurrentUser()
			}
		} catch (e) {
			console.error('Failed to initialize store:', e)
			error.value = e instanceof Error ? e : new Error('Failed to initialize store')
		} finally {
			isLoading.value = false
		}
	}

	// ==================== Lifecycle ====================

	let unsubscribeTableListener: (() => void) | null = null
	let unsubscribeAuthListener: (() => void) | null = null
	let unsubscribeSyncListener: (() => void) | null = null

	onMounted(async () => {
		await initialize()

		// Subscribe to store changes for reactive updates
		unsubscribeTableListener = addTablesListener(() => {
			refreshSessions()
		})

		// Subscribe to auth state changes and manage sync connection
		unsubscribeAuthListener = onAuthStateChange((state) => {
			user.value = state?.user || null

			if (state?.token && state?.user) {
				// Authenticated - start remote sync
				startRemoteSync(state.token, state.user.id)
			} else {
				// Not authenticated - stop remote sync
				stopRemoteSync()
			}
		})

		// Subscribe to sync status changes
		unsubscribeSyncListener = onSyncStatusChange((status) => {
			syncStatus.value = status
		})
	})

	onUnmounted(() => {
		if (unsubscribeTableListener) {
			unsubscribeTableListener()
		}
		if (unsubscribeAuthListener) {
			unsubscribeAuthListener()
		}
		if (unsubscribeSyncListener) {
			unsubscribeSyncListener()
		}
	})

	// ==================== Public Actions ====================

	/**
	 * Create a new session
	 * @returns Session ID
	 */
	function create(data: CreateSessionData): string {
		const sessionId = createSession(data)
		// Refresh will happen automatically via listener, but we can trigger immediately
		refreshSessions()
		return sessionId
	}

	/**
	 * Update session metadata
	 */
	function update(
		sessionId: string,
		data: Partial<{ title: string; description: string }>,
	): void {
		updateSession(sessionId, data)
		refreshSessions()
	}

	/**
	 * Delete a session
	 */
	function remove(sessionId: string): void {
		deleteSession(sessionId)
		refreshSessions()
	}

	/**
	 * Get a single session by ID
	 */
	function get(sessionId: string): AssembledSession | null {
		return getSession(sessionId)
	}

	// ==================== Return ====================

	/**
	 * Import legacy sessions from old localStorage that aren't in TinyBase yet.
	 * Triggers sync push automatically via the tables listener.
	 * @returns Number of sessions imported
	 */
	function importLegacy(): number {
		const count = importLegacySessions()
		if (count > 0) refreshSessions()
		return count
	}

	return {
		// State
		sessions,
		isInitialized,
		isLoading,
		error,

		// Auth state
		user,
		isLoggedIn,

		// Sync state
		syncStatus,
		isSyncing,

		// Actions
		createSession: create,
		updateSession: update,
		deleteSession: remove,
		getSession: get,
		refreshSessions,
		importLegacySessions: importLegacy,
	}
}

// ==================== Utility Functions ====================

/**
 * Singleton instance for use outside of Vue components
 * Useful for background scripts or utilities
 */
let singletonInitialized = false

export async function initializeTinyBaseStore(): Promise<void> {
	if (singletonInitialized) return

	if (!isStoreInitialized()) {
		await initializeStore()
	}

	singletonInitialized = true
}

/**
 * Get all sessions (non-reactive, for use outside Vue)
 */
export function getTinyBaseSessions(): AssembledSession[] {
	return getAllSessions()
}

/**
 * Create a session (non-reactive, for use outside Vue)
 */
export function createTinyBaseSession(data: CreateSessionData): string {
	return createSession(data)
}

/**
 * Delete a session (non-reactive, for use outside Vue)
 */
export function deleteTinyBaseSession(sessionId: string): void {
	deleteSession(sessionId)
}
