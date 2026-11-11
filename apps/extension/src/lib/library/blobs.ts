/**
 * Version contents, stored apart from the library index: one chrome.storage entry per
 * version. Versions never change once written, so reads are cached for good.
 */
import type { VersionData } from './model'

export interface VersionBlobs {
	get(id: string): Promise<VersionData | null>
	getMany(ids: string[]): Promise<Map<string, VersionData>>
	set(entries: Record<string, VersionData>): Promise<void>
	delete(ids: string[]): Promise<void>
	/** Every stored version id */
	ids(): Promise<string[]>
}

export const VERSION_KEY_PREFIX = 'library:version:'
const keyOf = (id: string) => `${VERSION_KEY_PREFIX}${id}`

export function chromeBlobs(): VersionBlobs {
	const cache = new Map<string, VersionData>()

	async function getMany(ids: string[]): Promise<Map<string, VersionData>> {
		const missing = ids.filter((id) => !cache.has(id))
		if (missing.length) {
			const stored = await chrome.storage.local.get(missing.map(keyOf))
			for (const id of missing) {
				const raw = stored[keyOf(id)]
				if (typeof raw === 'string') cache.set(id, JSON.parse(raw) as VersionData)
			}
		}
		return new Map(ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)!]))
	}

	return {
		async get(id) {
			return (await getMany([id])).get(id) ?? null
		},
		getMany,
		async set(entries) {
			await chrome.storage.local.set(
				Object.fromEntries(
					Object.entries(entries).map(([id, data]) => [keyOf(id), JSON.stringify(data)]),
				),
			)
			for (const [id, data] of Object.entries(entries)) cache.set(id, data)
		},
		async delete(ids) {
			if (!ids.length) return
			await chrome.storage.local.remove(ids.map(keyOf))
			for (const id of ids) cache.delete(id)
		},
		async ids() {
			const all = await chrome.storage.local.get(null)
			return Object.keys(all)
				.filter((key) => key.startsWith(VERSION_KEY_PREFIX))
				.map((key) => key.slice(VERSION_KEY_PREFIX.length))
		},
	}
}

export function memoryBlobs(): VersionBlobs {
	const data = new Map<string, string>()
	return {
		async get(id) {
			const raw = data.get(id)
			return raw ? (JSON.parse(raw) as VersionData) : null
		},
		async getMany(ids) {
			return new Map(
				ids
					.filter((id) => data.has(id))
					.map((id) => [id, JSON.parse(data.get(id)!) as VersionData]),
			)
		},
		async set(entries) {
			for (const [id, value] of Object.entries(entries)) data.set(id, JSON.stringify(value))
		},
		async delete(ids) {
			for (const id of ids) data.delete(id)
		},
		async ids() {
			return [...data.keys()]
		},
	}
}
