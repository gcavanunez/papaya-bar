/**
 * Upgrading a stored library index to the current schema, one link per version, when
 * the library opens (and after a move-in or an import writes an older shape).
 *
 * Only the background worker upgrades, but it may be stopped halfway and run the chain
 * again, and copies upgraded apart may still merge, so every link is idempotent and
 * deterministic: it only reads the index (and what is stored for this device) and
 * writes the same result every time.
 */
import type { Library } from './store'

export const LIBRARY_SCHEMA_VERSION = 2
/** Where the index is kept as it was before the first upgrade, in case one goes wrong */
export const INDEX_V1_KEY = 'library:index:v1'

/** Each link takes the index from its version to the next, and records that it did */
const LINKS: Record<number, (lib: Library) => Promise<void>> = {
	1: oneToTwo,
}

export interface UpgradeOptions {
	/** Runs once before the first change; if it fails, nothing is changed */
	keepCopy?: () => Promise<void>
}

export async function upgradeLibrary(lib: Library, options: UpgradeOptions = {}): Promise<void> {
	let version = Number(lib.store.getValue('schemaVersion')) || 0
	if (version >= LIBRARY_SCHEMA_VERSION) return
	// Nothing stored yet, or rows written before the version was recorded
	if (version === 0) {
		if (!lib.store.hasTable('sessions') && !lib.store.hasValue('openSessionId')) return
		version = 1
	}
	await options.keepCopy?.()
	for (; version < LIBRARY_SCHEMA_VERSION; version++) await LINKS[version](lib)
}

/** Copy the stored index, untouched, to INDEX_V1_KEY unless a copy is already there */
export async function keepIndexCopy(index: unknown): Promise<void> {
	if (index === undefined) return
	if (INDEX_V1_KEY in (await chrome.storage.local.get(INDEX_V1_KEY))) return
	await chrome.storage.local.set({ [INDEX_V1_KEY]: index })
}

const LEGACY_VALUES = ['openSessionId', 'parkedSessionId', 'homeSessionId'] as const

/**
 * 1 → 2: which session is open becomes this device's own state; a session's status
 * becomes `archivedAt`; Parked becomes an ordinary session.
 */
async function oneToTwo(lib: Library): Promise<void> {
	const { store } = lib
	const open = store.getValue('openSessionId')
	if (typeof open === 'string' && open && store.hasRow('sessions', open)) {
		if (!(await lib.device.read()).openSessionId) await lib.device.set({ openSessionId: open })
	}
	store.transaction(() => {
		for (const [id, row] of Object.entries(store.getTable('sessions'))) {
			if (row.kind === 'parked') store.setCell('sessions', id, 'kind', 'normal')
			if (row.status === undefined) continue
			// A session archived since an interrupted upgrade keeps its own date
			if (row.status === 'archived' && !(Number(row.archivedAt) > 0)) {
				const at = Number(row.updatedAt) || Number(row.createdAt) || 1
				store.setCell('sessions', id, 'archivedAt', at)
			} else if (row.archivedAt === undefined) {
				store.setCell('sessions', id, 'archivedAt', 0)
			}
			store.delCell('sessions', id, 'status')
		}
		for (const key of LEGACY_VALUES) store.delValue(key)
		store.setValue('schemaVersion', 2)
	})
}
