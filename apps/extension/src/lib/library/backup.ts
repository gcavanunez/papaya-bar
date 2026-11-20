/**
 * The library's part of a backup file: the index, plus the contents of every version and
 * stashed group.
 *
 * Importing writes fresh rows rather than loading the file's store as-is: other open
 * pages merge what they hear, so only new writes (and deletions, for Replace) are
 * guaranteed to win over the copies they still hold.
 */
import type { MergeableContent } from 'tinybase'
import type { MigrationResult } from './migrate'
import type { SessionContent } from './model'
import { applyMigration, createLibrary, getOpenSessionId, getSession, type Library } from './store'
import { upgradeLibrary } from './upgrade'

export interface LibraryBackup {
	index: MergeableContent
	versions: Record<string, SessionContent>
}

export async function exportLibrary(lib: Library): Promise<LibraryBackup> {
	// Contents of every version and every stashed group
	const ids = [
		...Object.keys(lib.store.getTable('versions')),
		...Object.keys(lib.store.getTable('stashed')),
	]
	const versions = await lib.blobs.getMany(ids)
	return { index: lib.store.getMergeableContent(), versions: Object.fromEntries(versions) }
}

type Tables = Record<string, Record<string, Record<string, string | number | boolean>>>
type Values = Record<string, string | number | boolean>

/**
 * Rows and contents to import, from a library backup or a planned migration, brought up
 * to the current schema in a library of their own
 */
async function rowsOf(source: LibraryBackup | MigrationResult): Promise<{
	tables: Tables
	values: Values
	versions: Record<string, SessionContent>
}> {
	const temp = createLibrary()
	let versions: Record<string, SessionContent>
	if ('index' in source) {
		temp.store.setMergeableContent(source.index)
		versions = source.versions
		await upgradeLibrary(temp)
	} else {
		await applyMigration(temp, source)
		versions = Object.fromEntries(await temp.blobs.getMany(Object.keys(source.versions)))
	}
	return {
		tables: temp.store.getTables() as Tables,
		values: temp.store.getValues() as Values,
		versions,
	}
}

/**
 * Bring a backup's sessions into the library. Which session is open on this device
 * stays as it is; if that session is gone afterwards, the device has none (Home).
 */
export async function importLibrary(
	lib: Library,
	source: LibraryBackup | MigrationResult,
	mode: 'replace' | 'merge',
): Promise<{ sessions: number; versions: number }> {
	const { tables, values, versions } = await rowsOf(source)
	await lib.blobs.set(versions)
	const replaced =
		mode === 'replace'
			? [
					...Object.keys(lib.store.getTable('versions')),
					...Object.keys(lib.store.getTable('stashed')),
				]
			: []
	lib.store.transaction(() => {
		if (mode === 'replace') lib.store.delTables()
		for (const [tableId, rows] of Object.entries(tables)) {
			for (const [rowId, row] of Object.entries(rows)) lib.store.setRow(tableId, rowId, row)
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
	const open = getOpenSessionId(lib)
	if (open && !getSession(lib, open)) await lib.device.set({ openSessionId: '' })
	await lib.blobs.delete(replaced.filter((id) => !(id in versions)))
	return {
		sessions: Object.keys(tables.sessions ?? {}).length,
		versions: Object.keys(tables.versions ?? {}).length,
	}
}
