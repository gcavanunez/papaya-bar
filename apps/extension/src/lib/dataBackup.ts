/**
 * Manual data backup — "Download my data" / "Import data".
 *
 * Bundles everything that's *yours* into one JSON file:
 *  - library:        your sessions and every version's contents
 *  - tinybase:       the old contexts store, kept as the rollback copy
 *  - legacySessions: the old saved-sessions list (chrome.storage.local)
 *  - settings:       UI preferences
 *
 * The auth token is deliberately NOT included.
 */
import { initializeStore, store, getStoreContent } from '@/sync/store'
import type { Content } from 'tinybase'
import { exportLibrary, importLibrary, type LibraryBackup } from '@/lib/library/backup'
import { planMigration, type OldStoreContent } from '@/lib/library/migrate'
import { getLibrary } from '@/lib/library/runtime'

const SESSIONS_KEY = 'sessions:saved'
const SETTINGS_KEY = 'chonching-tabs-settings'

export interface BackupFile {
	app: 'papaya-bar'
	version: number
	exportedAt: string
	library?: LibraryBackup
	tinybase: Content
	legacySessions: unknown
	settings: unknown
}

async function getLocal<T>(key: string, fallback: T): Promise<T> {
	try {
		if (typeof chrome !== 'undefined' && chrome.storage?.local) {
			const r = await chrome.storage.local.get(key)
			return (r[key] as T) ?? fallback
		}
	} catch {
		/* ignore */
	}
	return fallback
}

/** Assemble the full backup object. */
export async function buildBackup(): Promise<BackupFile> {
	// The old store only loads on demand now; it's still part of every backup
	await initializeStore()
	const [legacySessions, settings, library] = await Promise.all([
		getLocal<unknown>(SESSIONS_KEY, []),
		getLocal<unknown>(SETTINGS_KEY, null),
		getLibrary().then(exportLibrary),
	])
	return {
		app: 'papaya-bar',
		version: 2,
		exportedAt: new Date().toISOString(),
		library,
		tinybase: getStoreContent(),
		legacySessions,
		settings,
	}
}

/** Build the backup and trigger a file download. */
export async function downloadBackup(): Promise<void> {
	const backup = await buildBackup()
	const json = JSON.stringify(backup, null, 2)
	const blob = new Blob([json], { type: 'application/json' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `papaya-backup-${new Date().toISOString().slice(0, 10)}.json`
	document.body.appendChild(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}

export interface BackupStats {
	/** Sessions in the library */
	sessions: number
	versions: number
	bytes: number
}

/** Counts + size for the current data, for the Settings summary line. */
export async function getBackupStats(): Promise<BackupStats> {
	const backup = await buildBackup()
	const bytes = new Blob([JSON.stringify(backup)]).size
	const lib = await getLibrary()
	return {
		sessions: Object.keys(lib.store.getTable('sessions')).length,
		versions: Object.keys(lib.store.getTable('versions')).length,
		bytes,
	}
}

export type ImportMode = 'replace' | 'merge'

export interface ImportSummary {
	sessions: number
	versions: number
}

/**
 * Restore from a backup file.
 * - 'replace' overwrites current data with the backup's.
 * - 'merge' adds the backup's rows/sessions on top of current (backup wins on
 *   id/key collisions), keeping everything you already have.
 * Caller should confirm with the user first and reload the page afterward.
 */
export async function importBackup(file: File, mode: ImportMode = 'replace'): Promise<ImportSummary> {
	const data = JSON.parse(await file.text()) as Partial<BackupFile>
	if (data.app !== 'papaya-bar' || !data.tinybase) {
		throw new Error('That doesn\u2019t look like a Papaya backup file.')
	}

	// The old store (the rollback copy) is restored too, so it must be loaded first
	await initializeStore()
	if (mode === 'replace') {
		// Replace the whole TinyBase store. Autosave persists it.
		store.setContent(data.tinybase)
	} else {
		// Merge: add each backup row (overwriting same ids), keep existing rows.
		const [tables] = data.tinybase
		store.transaction(() => {
			for (const [tableId, rows] of Object.entries(tables ?? {})) {
				for (const [rowId, row] of Object.entries(rows)) {
					store.setRow(tableId, rowId, row as Record<string, string | number | boolean>)
				}
			}
		})
	}

	// Restore legacy sessions + settings.
	if (typeof chrome !== 'undefined' && chrome.storage?.local) {
		const toSet: Record<string, unknown> = {}
		const backupLegacy = Array.isArray(data.legacySessions)
			? (data.legacySessions as [string, unknown][])
			: []

		if (mode === 'merge') {
			const current = await getLocal<[string, unknown][]>(SESSIONS_KEY, [])
			const cur = Array.isArray(current) ? current : []
			toSet[SESSIONS_KEY] = [...new Map([...cur, ...backupLegacy]).entries()]
		} else if (data.legacySessions !== undefined) {
			toSet[SESSIONS_KEY] = data.legacySessions
			if (data.settings != null) toSet[SETTINGS_KEY] = data.settings
		}

		if (Object.keys(toSet).length) await chrome.storage.local.set(toSet)
	}

	// Sessions: a new backup carries the library; an old one goes through the migration
	const source =
		data.library ??
		planMigration({
			store: data.tinybase as OldStoreContent,
			savedSessions: data.legacySessions ?? [],
		})
	return importLibrary(await getLibrary(), source, mode)
}
