/**
 * The library's part of a backup file: the index, plus every version's contents.
 *
 * Importing writes fresh rows rather than loading the file's store as-is: other open
 * pages merge what they hear, so only new writes (and deletions, for Replace) are
 * guaranteed to win over the copies they still hold.
 */
import type { MergeableContent } from 'tinybase'
import type { MigrationResult } from './migrate'
import { parseVersion, type VersionData } from './model'
import { createLibrary, type Library } from './store'

export interface LibraryBackup {
	index: MergeableContent
	versions: Record<string, VersionData>
}

export async function exportLibrary(lib: Library): Promise<LibraryBackup> {
	const ids = Object.keys(lib.store.getTable('versions'))
	const versions = await lib.blobs.getMany(ids)
	return { index: lib.store.getMergeableContent(), versions: Object.fromEntries(versions) }
}

type Tables = Record<string, Record<string, Record<string, string | number | boolean>>>
type Values = Record<string, string | number | boolean>

/** Rows and contents to import, from a library backup or a planned migration */
function rowsOf(source: LibraryBackup | MigrationResult): {
	tables: Tables
	values: Values
	versions: Record<string, VersionData>
} {
	if ('index' in source) {
		const temp = createLibrary()
		temp.store.setMergeableContent(source.index)
		return {
			tables: temp.store.getTables() as Tables,
			values: temp.store.getValues() as Values,
			versions: source.versions,
		}
	}
	const versions: Record<string, VersionData> = {}
	const versionRows: Tables[string] = {}
	for (const [id, { data, ...meta }] of Object.entries(source.versions)) {
		versions[id] = parseVersion({ data })
		versionRows[id] = meta as unknown as Tables[string][string]
	}
	return {
		tables: {
			sessions: source.sessions as unknown as Tables[string],
			versions: versionRows,
		},
		values: { ...source.values, schemaVersion: 1, migratedAt: Date.now() },
		versions,
	}
}

export async function importLibrary(
	lib: Library,
	source: LibraryBackup | MigrationResult,
	mode: 'replace' | 'merge',
): Promise<{ sessions: number; versions: number }> {
	const { tables, values, versions } = rowsOf(source)
	await lib.blobs.set(versions)
	const replaced = mode === 'replace' ? Object.keys(lib.store.getTable('versions')) : []
	lib.store.transaction(() => {
		if (mode === 'replace') lib.store.delTables()
		for (const [tableId, rows] of Object.entries(tables)) {
			for (const [rowId, row] of Object.entries(rows)) lib.store.setRow(tableId, rowId, row)
		}
		// Keep the open session if the backup has none; otherwise take the backup's
		lib.store.setPartialValues(
			mode === 'merge'
				? Object.fromEntries(
						Object.entries(values).filter(([key]) => !lib.store.getValue(key)),
					)
				: values,
		)
	})
	await lib.blobs.delete(replaced.filter((id) => !(id in versions)))
	return {
		sessions: Object.keys(tables.sessions ?? {}).length,
		versions: Object.keys(tables.versions ?? {}).length,
	}
}
