/**
 * contextBridge — keeps a read-model of contexts in chrome.storage.local so the
 * content-script palette (which can't touch the localStorage-backed store) can
 * read it, and drains store mutations that the background worker queued during
 * swaps initiated from a website.
 *
 * Runs in extension PAGE context (it imports the real store).
 */
import {
	appendTabsToContext,
	createContext,
	getActiveContextId,
	getAllContextTabs,
	getAllContexts,
	setActiveContextId,
	setContextHead,
	type CaptureData,
} from '@/sync/store'
import type { SaveableTab } from '@/types'

export const MIRROR_KEY = 'papaya:mirror'
export const OPS_KEY = 'papaya:storeOps'

export interface MirrorContext {
	id: string
	name: string
	color: string
	tabCount: number
	// Full restore payload so the background worker can reopen without the store.
	restore: { tabs: SaveableTab[]; windows: unknown[]; groups: unknown[] }
}

export interface MirrorSavedTab {
	key: string
	title: string
	url: string
	favIconUrl: string
	contextId: string
	contextName: string
}

export interface PaletteMirror {
	activeContextId: string
	contexts: MirrorContext[]
	savedTabs: MirrorSavedTab[]
	updatedAt: number
}

export type StoreOp =
	| { type: 'create'; name: string; capture: CaptureData; activate?: boolean }
	| { type: 'setHead'; contextId: string; capture: CaptureData }
	| { type: 'setActive'; contextId: string }
	| { type: 'append'; contextId: string; tabs: SaveableTab[] }

/** Write the current contexts read-model to chrome.storage.local. */
export async function publishMirror(): Promise<void> {
	const contexts = getAllContexts()
	const mirrorContexts: MirrorContext[] = contexts.map((c) => ({
		id: c.id,
		name: c.name,
		color: c.color,
		tabCount: c.tabCount,
		restore: c.session
			? { tabs: c.session.tabs, windows: c.session.windows, groups: c.session.groups }
			: { tabs: [], windows: [], groups: [] },
	}))
	const savedTabs: MirrorSavedTab[] = getAllContextTabs(500)
	const mirror: PaletteMirror = {
		activeContextId: getActiveContextId(),
		contexts: mirrorContexts,
		savedTabs,
		updatedAt: Date.now(),
	}
	await chrome.storage.local.set({ [MIRROR_KEY]: mirror })
}

/** Apply any store mutations the background worker queued, then republish. */
export async function drainStoreOps(): Promise<void> {
	const stored = await chrome.storage.local.get(OPS_KEY)
	const ops = stored[OPS_KEY] as StoreOp[] | undefined
	if (!Array.isArray(ops) || ops.length === 0) return

	for (const op of ops) {
		try {
			if (op.type === 'create') {
				createContext({ name: op.name, capture: op.capture, activate: op.activate })
			} else if (op.type === 'setHead') {
				setContextHead(op.contextId, op.capture)
			} else if (op.type === 'setActive') {
				setActiveContextId(op.contextId)
			} else if (op.type === 'append') {
				appendTabsToContext(op.contextId, op.tabs)
			}
		} catch (e) {
			console.error('[contextBridge] failed to apply op', op, e)
		}
	}

	await chrome.storage.local.remove(OPS_KEY)
	await publishMirror()
}
