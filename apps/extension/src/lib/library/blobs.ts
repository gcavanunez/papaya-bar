/**
 * Contents stored apart from the library index: one chrome.storage entry per session
 * content or checkpoint (keys keep the original "version" prefix).
 * Entries never change once written, so reads are cached until the stored entry is
 * deleted or replaced.
 */
import type { SessionContent } from './model'

export interface ContentBlobs {
	get(id: string): Promise<SessionContent | null>
	getMany(ids: string[]): Promise<Map<string, SessionContent>>
	set(entries: Record<string, SessionContent>): Promise<void>
	delete(ids: string[]): Promise<void>
	/** Every stored entry's id */
	ids(): Promise<string[]>
}

export const VERSION_KEY_PREFIX = 'library:version:'
const keyOf = (id: string) => `${VERSION_KEY_PREFIX}${id}`

/**
 * Entries in chrome.storage.local. A read-only copy (a page's) rejects writes, since
 * only the background worker writes the library; every copy forgets an entry once
 * another context deletes or rewrites it.
 */
export function chromeBlobs(options: { readOnly?: boolean } = {}): ContentBlobs {
	const cache = new Map<string, SessionContent>()
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return
		for (const key of Object.keys(changes)) {
			if (key.startsWith(VERSION_KEY_PREFIX))
				cache.delete(key.slice(VERSION_KEY_PREFIX.length))
		}
	})
	const refuse = () =>
		Promise.reject(
			new Error('A page cannot change saved tabs; the background worker writes them'),
		)

	async function getMany(ids: string[]): Promise<Map<string, SessionContent>> {
		const missing = ids.filter((id) => !cache.has(id))
		if (missing.length) {
			const stored = await chrome.storage.local.get(missing.map(keyOf))
			for (const id of missing) {
				const raw = stored[keyOf(id)]
				if (typeof raw === 'string') cache.set(id, JSON.parse(raw) as SessionContent)
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
			if (options.readOnly) return refuse()
			await chrome.storage.local.set(
				Object.fromEntries(
					Object.entries(entries).map(([id, data]) => [keyOf(id), JSON.stringify(data)]),
				),
			)
			for (const [id, data] of Object.entries(entries)) cache.set(id, data)
		},
		async delete(ids) {
			if (options.readOnly) return refuse()
			if (!ids.length) return
			await chrome.storage.local.remove(ids.map(keyOf))
			for (const id of ids) cache.delete(id)
		},
		async ids() {
			// Keys alone where Chrome can (130+), rather than every stored tab
			const keys = chrome.storage.local.getKeys
				? await chrome.storage.local.getKeys()
				: Object.keys(await chrome.storage.local.get(null))
			return keys
				.filter((key) => key.startsWith(VERSION_KEY_PREFIX))
				.map((key) => key.slice(VERSION_KEY_PREFIX.length))
		},
	}
}

export function memoryBlobs(): ContentBlobs {
	const data = new Map<string, string>()
	return {
		async get(id) {
			const raw = data.get(id)
			return raw ? (JSON.parse(raw) as SessionContent) : null
		},
		async getMany(ids) {
			return new Map(
				ids
					.filter((id) => data.has(id))
					.map((id) => [id, JSON.parse(data.get(id)!) as SessionContent]),
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
