/**
 * The one-time move from saved sessions and contexts into the library. Pages only: it
 * reads the old TinyBase store, which lives in a page's IndexedDB.
 */
import { planMigration, type MigrationResult, type OldStoreContent } from './migrate'
import { applyMigration, type Library } from './store'

const SAVED_SESSIONS_KEY = 'sessions:saved'

/** Plan the move from the current old data; writes nothing */
export async function previewMoveIn(): Promise<MigrationResult> {
	const { initializeStore, getStoreContent } = await import('@/sync/store')
	await initializeStore()
	const saved = (await chrome.storage.local.get(SAVED_SESSIONS_KEY))[SAVED_SESSIONS_KEY]
	return planMigration({
		store: getStoreContent() as OldStoreContent,
		savedSessions: saved ?? [],
	})
}

/** True when there's nothing to move, so the move can happen without asking */
export function isNothingToMove(result: MigrationResult): boolean {
	const { found } = result.report
	return !found.contexts && !found.savedSessions && !result.report.created.tabs
}

export async function moveIn(lib: Library, result: MigrationResult): Promise<void> {
	await applyMigration(lib, result)
}
