/**
 * The library's part of a backup file: the index, plus every entry it refers to (each
 * session's content and its checkpoints). An older backup is upgraded as it's read, so
 * its stashed groups come in as sessions of their own.
 *
 * Importing writes fresh rows rather than loading the file's store as-is: other open
 * pages merge what they hear, so only new writes (and deletions, for Replace) are
 * guaranteed to win over the copies they still hold.
 */
import type { MergeableContent } from 'tinybase'
import { currentSessionId } from './actions'
import type { MigrationResult } from './migrate'
import { makeCheckpoint, type SessionContent } from './model'
import {
	applyMigration,
	createLibrary,
	getOpenSessionId,
	getSession,
	referencedEntries,
	releaseEntries,
	setLink,
	type Library,
} from './store'
import { fromStored } from './persist'
import { upgradeLibrary } from './upgrade'

export interface LibraryBackup {
	index: MergeableContent
	/** Every entry the index refers to, by id; named for the versions the first backups held */
	versions: Record<string, SessionContent>
}

export async function exportLibrary(lib: Library): Promise<LibraryBackup> {
	const entries = await lib.blobs.getMany([...referencedEntries(lib)])
	return { index: lib.store.getMergeableContent(), versions: Object.fromEntries(entries) }
}

type Tables = Record<string, Record<string, Record<string, string | number | boolean>>>
type Values = Record<string, string | number | boolean>

/**
 * Rows and entries to import, from a library backup or a planned migration, brought up
 * to the current schema in a library of their own
 */
async function rowsOf(source: LibraryBackup | MigrationResult): Promise<{
	tables: Tables
	values: Values
	entries: Record<string, SessionContent>
}> {
	const temp = createLibrary()
	if ('index' in source) {
		// A backup file is JSON, so its deletions are read back as deletions
		temp.store.setMergeableContent(fromStored(source.index) ?? source.index)
		// The upgrade keeps only what has its entry, so the entries go in first
		await temp.blobs.set(source.versions ?? {})
		await upgradeLibrary(temp)
	} else {
		await applyMigration(temp, source)
	}
	await dropMissing(temp)
	return {
		tables: temp.store.getTables() as Tables,
		values: temp.store.getValues() as Values,
		entries: Object.fromEntries(await temp.blobs.getMany([...referencedEntries(temp)])),
	}
}

/**
 * Bring a backup's sessions into the library. Which session is open on this device
 * stays as it is; if that session is gone afterwards, the device has none (Home).
 * Merging keeps a session's own content as a checkpoint when the backup replaces it.
 */
export async function importLibrary(
	lib: Library,
	source: LibraryBackup | MigrationResult,
	mode: 'replace' | 'merge',
	now = Date.now(),
): Promise<{ sessions: number; checkpoints: number }> {
	const { tables, values, entries } = await rowsOf(source)
	await lib.blobs.set(entries)
	const replaced = mode === 'replace' ? [...referencedEntries(lib)] : []
	const displaced = mode === 'merge' ? await displacedContents(lib, tables) : []
	lib.store.transaction(() => {
		if (mode === 'replace') lib.store.delTables()
		for (const [tableId, rows] of Object.entries(tables)) {
			for (const [rowId, row] of Object.entries(rows)) lib.store.setRow(tableId, rowId, row)
		}
		for (const { id, sessionId, data } of displaced) {
			if (!referencedEntries(lib).has(id))
				lib.store.setRow('checkpoints', id, {
					...makeCheckpoint(sessionId, data, 'import', now),
				})
		}
		// Merging keeps the library's own schema version and move-in date
		lib.store.setPartialValues(
			mode === 'merge'
				? Object.fromEntries(
						Object.entries(values).filter(([key]) => !lib.store.getValue(key)),
					)
				: values,
		)
	})
	await ownEntriesOnce(lib)

	const open = getOpenSessionId(lib)
	if (open && !getSession(lib, open)) await lib.device.set({ openSessionId: '' })
	// The open session's content may have changed: decide afresh whether the open windows are its
	if (tables.sessions?.[currentSessionId(lib)] || (open && !getSession(lib, open)))
		await setLink(lib, 'unknown', now)
	await releaseEntries(lib, replaced)
	return {
		sessions: Object.keys(tables.sessions ?? {}).length,
		checkpoints: Object.keys(tables.checkpoints ?? {}).length,
	}
}

/**
 * A backup missing some entries would import rows pointing at nothing: those rows are
 * dropped, and a session whose content is missing has none
 */
async function dropMissing(temp: Library): Promise<void> {
	const stored = new Set(await temp.blobs.ids())
	temp.store.transaction(() => {
		for (const [id, row] of Object.entries(temp.store.getTable('sessions'))) {
			if (row.contentId && !stored.has(String(row.contentId)))
				temp.store.setPartialRow('sessions', id, {
					contentId: '',
					tabCount: 0,
					preview: '[]',
				})
		}
		for (const id of temp.store.getRowIds('checkpoints'))
			if (!stored.has(id)) temp.store.delRow('checkpoints', id)
	})
}

/** Sessions' own contents that a merge is about to point elsewhere */
async function displacedContents(lib: Library, tables: Tables) {
	const displaced: { id: string; sessionId: string; data: SessionContent }[] = []
	for (const [sessionId, row] of Object.entries(tables.sessions ?? {})) {
		const id = getSession(lib, sessionId)?.contentId
		if (!id || id === row.contentId) continue
		const data = await lib.blobs.get(id)
		if (data?.tabs.length) displaced.push({ id, sessionId, data })
	}
	return displaced
}

/**
 * A merge can leave an entry with two owners (a backup's content that is a checkpoint
 * here, say). Each session whose content is owned elsewhere gets its own copy, so
 * deleting one owner's entry never takes another's.
 */
async function ownEntriesOnce(lib: Library): Promise<void> {
	const others = new Set(Object.keys(lib.store.getTable('checkpoints')))
	for (const [sessionId, row] of Object.entries(lib.store.getTable('sessions'))) {
		const id = String(row.contentId ?? '')
		if (!id) continue
		if (others.has(id)) {
			const data = await lib.blobs.get(id)
			const copy = data ? crypto.randomUUID() : ''
			if (data) await lib.blobs.set({ [copy]: data })
			lib.store.setCell('sessions', sessionId, 'contentId', copy)
		}
		others.add(id)
	}
}
