/**
 * useContexts — the swap loop.
 *
 * A "context" is a living bucket of tabs (a project/topic) that you swap in and
 * out of the live browser. At most one context is "active" (checked out) at a
 * time; when none is active you're in the Inbox (the live, unassigned tabs).
 *
 * Core operations:
 * - resume(id):   auto-stash the active context, close live tabs, open the target
 * - stashActive:  capture + close the active context, returning you to the Inbox
 * - createFromLive: name the current live tabs into a new context
 * - peelOff:      move a selection of tabs into a context (the all-or-nothing fix)
 *
 * Window/group restoration reuses the existing openAll() machinery.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
	addContextsListener,
	appendTabsToContext,
	createContext as storeCreateContext,
	deleteContext as storeDeleteContext,
	ensureParkedContext,
	getActiveContextId,
	getAllContexts,
	getContext,
	setActiveContextId,
	setContextHead,
	updateContext as storeUpdateContext,
	type AssembledContext,
	type CaptureData,
} from '@/sync/store'
import { initializeTinyBaseStore } from '@/hooks/useTinyBaseStore'
import { useSessionsData } from '@/hooks/useSessionsData'
import { drainStoreOps, OPS_KEY, publishMirror } from '@/lib/contextBridge'
import type { Group, SaveableTab } from '@/types'

// ==================== Shared (per-document) state ====================

const contexts = ref<AssembledContext[]>([])
const activeContextId = ref('')
const isReady = ref(false)
const liveStats = ref<{ total: number; stale: number }>({ total: 0, stale: 0 })

const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

// ==================== Chrome capture helpers ====================

function extPrefix(): string {
	return `chrome-extension://${chrome.runtime.id}`
}

/** True for the extension's own pages (manager / side panel) — never closed/saved. */
function isOwnPage(tab: chrome.tabs.Tab): boolean {
	const prefix = extPrefix()
	return (tab.url || '').startsWith(prefix) || (tab.pendingUrl || '').startsWith(prefix)
}

function mapToSaveable(tab: chrome.tabs.Tab): SaveableTab {
	return {
		id: tab.id,
		stableId: `stableId-${tab.id}`,
		url: tab.url,
		title: tab.title,
		favIconUrl: tab.favIconUrl,
		windowId: tab.windowId,
		groupId: tab.groupId,
		active: tab.active,
	}
}

async function queryLiveTabs(): Promise<SaveableTab[]> {
	const tabs = await chrome.tabs.query({})
	return tabs.filter((t) => !isOwnPage(t)).map(mapToSaveable)
}

/**
 * Capture the current browser state into a storable shape.
 * Pass `tabsInput` to capture only a subset of tabs (peel-off) while still
 * recording the live window layout so they can be restored later.
 */
async function captureLiveData(tabsInput?: SaveableTab[]): Promise<CaptureData> {
	const [allWindows, groups] = await Promise.all([
		chrome.windows.getAll(),
		chrome.tabGroups.query({}),
	])
	const tabs = tabsInput ?? (await queryLiveTabs())
	const windows = allWindows.map((w) => ({
		id: w.id,
		width: w.width,
		left: w.left,
		height: w.height,
		top: w.top,
	}))
	return { tabs, groups, windows }
}

/** IDs of tabs that a swap is allowed to close (not extension pages, not pinned). */
async function getCloseableTabIds(): Promise<number[]> {
	const tabs = await chrome.tabs.query({})
	return tabs.filter((t) => t.id != null && !isOwnPage(t) && !t.pinned).map((t) => t.id as number)
}

function shortTime(): string {
	return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Tracks what to restore on "Undo" after the most recent swap/stash.
const lastSwapRestoreId = ref<string | null>(null)

// ==================== Composable ====================

export function useContexts() {
	const { openAll } = useSessionsData()

	function refresh(): void {
		contexts.value = getAllContexts()
		activeContextId.value = getActiveContextId()
		// Keep the content-script palette's read-model in sync.
		void publishMirror()
	}

	// Apply store mutations queued by the background worker (swaps from a website).
	function onStorageChanged(
		changes: Record<string, chrome.storage.StorageChange>,
		area: string,
	): void {
		if (area === 'local' && changes[OPS_KEY]?.newValue) void drainStoreOps()
	}

	async function refreshLiveStats(): Promise<void> {
		const tabs = await chrome.tabs.query({})
		const normal = tabs.filter((t) => !isOwnPage(t))
		const now = Date.now()
		const stale = normal.filter((t) => (t.lastAccessed ?? now) < now - STALE_THRESHOLD_MS).length
		liveStats.value = { total: normal.length, stale }
	}

	const activeContext = computed(
		() => contexts.value.find((c) => c.id === activeContextId.value) ?? null,
	)

	/** Contexts shown in the switcher list (everything not active or archived). */
	const switchableContexts = computed(() =>
		contexts.value.filter((c) => c.id !== activeContextId.value && c.status !== 'archived'),
	)

	const archivedContexts = computed(() =>
		contexts.value.filter((c) => c.status === 'archived'),
	)

	// ---------- The swap loop ----------

	/** Reopen a context's tabs, auto-stashing whatever is currently active. */
	async function resume(contextId: string): Promise<void> {
		const target = getContext(contextId)
		if (!target?.session || target.session.tabs.length === 0) {
			toast.error('That context has no tabs to open')
			return
		}

		const previousActiveId = getActiveContextId()
		if (previousActiveId === contextId) return // already checked out

		// Snapshot what we're leaving BEFORE touching the browser.
		const closeIds = await getCloseableTabIds()
		const capture = await captureLiveData()

		// Decide what "Undo" should bring back.
		let restoreId: string | null = previousActiveId || null

		if (previousActiveId) {
			// Stash the active context into its head.
			setContextHead(previousActiveId, capture)
			storeUpdateContext(previousActiveId, { status: 'stashed' })
		} else if (capture.tabs.length > 0) {
			// In the Inbox: preserve loose tabs into a safety-net context so the
			// swap is never lossy. The user can rename/merge it later.
			restoreId = storeCreateContext({ name: `Unsorted · ${shortTime()}`, capture })
		}
		lastSwapRestoreId.value = restoreId

		// Open the target FIRST so a window exists before we close the old tabs
		// (closing the last tab in the panel's window would otherwise kill the swap).
		await openAll({
			title: target.name,
			description: '',
			tabs: target.session.tabs,
			groups: target.session.groups as unknown as Group[],
			windows: target.session.windows,
			displays: [],
		})

		storeUpdateContext(contextId, { status: 'active' })
		setActiveContextId(contextId)

		// Now retire the previous working set by id (won't touch the new tabs).
		if (closeIds.length) await chrome.tabs.remove(closeIds)
		refresh()

		toast(`Swapped to ${target.name}`, {
			action: { label: 'Undo', onClick: () => void undoSwap() },
		})
	}

	/** Reverse the most recent swap/stash. */
	async function undoSwap(): Promise<void> {
		const restoreId = lastSwapRestoreId.value
		if (restoreId) await resume(restoreId)
		else await stashActive()
	}

	/** Capture + close the active context, returning to an empty Inbox. */
	async function stashActive(): Promise<void> {
		const activeId = getActiveContextId()
		if (!activeId) return

		const closeIds = await getCloseableTabIds()
		const capture = await captureLiveData()
		setContextHead(activeId, capture)
		storeUpdateContext(activeId, { status: 'stashed' })
		setActiveContextId('')
		lastSwapRestoreId.value = activeId

		if (closeIds.length) await chrome.tabs.remove(closeIds)
		refresh()
		const ctx = contexts.value.find((c) => c.id === activeId)
		toast(`Stashed ${ctx?.name ?? 'context'}`, {
			action: { label: 'Undo', onClick: () => void resume(activeId) },
		})
	}

	/** Name the current live tabs (the Inbox) into a new context. */
	async function createFromLive(name: string, options: { activate?: boolean } = {}): Promise<string> {
		const capture = await captureLiveData()
		const id = storeCreateContext({ name, capture, activate: options.activate ?? true })
		refresh()
		toast(`Created context “${name}”`)
		return id
	}

	/**
	 * Move a selection of tabs into a context (new or existing) and close them
	 * from the live window. The all-or-nothing fix.
	 */
	async function peelOff(
		tabs: SaveableTab[],
		target: { contextId?: string; name?: string },
	): Promise<void> {
		if (tabs.length === 0) return

		let label = target.name
		if (target.contextId) {
			appendTabsToContext(target.contextId, tabs)
			label = contexts.value.find((c) => c.id === target.contextId)?.name
		} else if (target.name) {
			const capture = await captureLiveData(tabs)
			storeCreateContext({ name: target.name, capture })
		} else {
			return
		}

		const ids = tabs.map((t) => t.id).filter((id): id is number => id != null)
		if (ids.length) await chrome.tabs.remove(ids)
		refresh()
		toast(`Moved ${tabs.length} tab${tabs.length > 1 ? 's' : ''} to ${label ?? 'context'}`)
	}

	// ---------- Parking (taming sprawl) ----------

	/** Move tabs untouched for `days`+ into the Parked context and close them. */
	async function parkStaleTabs(days = 7): Promise<number> {
		const threshold = Date.now() - days * 24 * 60 * 60 * 1000
		const tabs = await chrome.tabs.query({})
		const stale = tabs.filter(
			(t) =>
				t.id != null &&
				!isOwnPage(t) &&
				!t.pinned &&
				!t.active &&
				(t.lastAccessed ?? Date.now()) < threshold,
		)
		if (!stale.length) return 0

		const parkedId = ensureParkedContext()
		appendTabsToContext(parkedId, stale.map(mapToSaveable))
		await chrome.tabs.remove(stale.map((t) => t.id as number))
		refresh()
		toast(`Parked ${stale.length} stale tab${stale.length > 1 ? 's' : ''}`, {
			action: { label: 'Open Parked', onClick: () => void resume(parkedId) },
		})
		return stale.length
	}

	/**
	 * Drain tabs the background worker parked while no page was open
	 * (see background.js auto-park) into the Parked context.
	 */
	async function drainParkQueue(): Promise<void> {
		const stored = await chrome.storage.local.get('papaya:parkQueue')
		const queue = stored['papaya:parkQueue'] as
			| Array<{ url?: string; title?: string; favIconUrl?: string }>
			| undefined
		if (!Array.isArray(queue) || queue.length === 0) return

		const parkedId = ensureParkedContext()
		appendTabsToContext(
			parkedId,
			queue.map((q, i) => ({
				stableId: `parked-${Date.now()}-${i}`,
				url: q.url,
				title: q.title,
				favIconUrl: q.favIconUrl,
				windowId: 0,
				active: false,
			})),
		)
		await chrome.storage.local.remove('papaya:parkQueue')
		refresh()
		toast(`Parked ${queue.length} stale tab${queue.length > 1 ? 's' : ''} while you were away`)
	}

	// ---------- Metadata ----------

	function rename(contextId: string, name: string): void {
		storeUpdateContext(contextId, { name })
		refresh()
	}

	function setColor(contextId: string, color: string): void {
		storeUpdateContext(contextId, { color })
		refresh()
	}

	function archive(contextId: string): void {
		storeUpdateContext(contextId, { status: 'archived' })
		refresh()
	}

	function unarchive(contextId: string): void {
		storeUpdateContext(contextId, { status: 'stashed' })
		refresh()
	}

	function remove(contextId: string): void {
		storeDeleteContext(contextId)
		refresh()
	}

	// ---------- Lifecycle ----------

	let unsubscribe: (() => void) | null = null

	onMounted(async () => {
		await initializeTinyBaseStore()
		isReady.value = true
		refresh()
		void refreshLiveStats()
		void drainParkQueue()
		void drainStoreOps()
		unsubscribe = addContextsListener(refresh)
		chrome.storage.onChanged.addListener(onStorageChanged)
	})

	onUnmounted(() => {
		unsubscribe?.()
		chrome.storage.onChanged.removeListener(onStorageChanged)
	})

	return {
		// state
		contexts,
		activeContext,
		activeContextId,
		switchableContexts,
		archivedContexts,
		liveStats,
		isReady,
		// actions
		resume,
		stashActive,
		undoSwap,
		createFromLive,
		peelOff,
		parkStaleTabs,
		rename,
		setColor,
		archive,
		unarchive,
		remove,
		refresh,
		refreshLiveStats,
	}
}
