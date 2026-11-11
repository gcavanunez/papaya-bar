/**
 * Keep the library index in chrome.storage.local, shared by every extension page and
 * the background worker.
 *
 * Each copy saves its whole index after every change, and merges (never replaces)
 * whatever another copy saved: Chrome tells every page and the worker when the entry
 * changes. If merging leaves this copy with something the saved one lacks (both wrote
 * at once), it saves again, so the stored index always ends up with both changes.
 */
import { createCustomPersister } from 'tinybase/persisters'
import type { MergeableContent, MergeableStore } from 'tinybase'

export const INDEX_KEY = 'library:index'

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void

/** Tables and values hashes, which differ whenever the contents differ */
const hashes = (content: MergeableContent | undefined) =>
	content ? `${content[0]?.[2]}:${content[1]?.[2]}` : ''

export async function startLibraryPersistence(store: MergeableStore) {
	let persister: ReturnType<typeof createCustomPersister> | null = null

	const persisterInstance = createCustomPersister(
		store,
		async () => {
			const stored = (await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY]
			return Array.isArray(stored) ? (stored as MergeableContent) : undefined
		},
		async (getContent) => {
			await chrome.storage.local.set({ [INDEX_KEY]: getContent() })
		},
		(listener) => {
			const onChanged: StorageListener = (changes, area) => {
				const saved = changes[INDEX_KEY]?.newValue as MergeableContent | undefined
				if (area !== 'local' || !Array.isArray(saved)) return
				if (hashes(saved) === hashes(store.getMergeableContent())) return
				// The trailing 1 marks these as changes, which TinyBase merges
				listener(undefined, [...saved, 1] as unknown as Parameters<typeof listener>[1])
				if (hashes(saved) !== hashes(store.getMergeableContent())) void persister?.save()
			}
			chrome.storage.onChanged.addListener(onChanged)
			return onChanged
		},
		(onChanged: StorageListener) => chrome.storage.onChanged.removeListener(onChanged),
		(error) => console.warn('[papaya] library storage', error),
		2, // MergeableStoreOnly
	)
	persister = persisterInstance
	await persisterInstance.startAutoLoad([{}, {}])
	await persisterInstance.startAutoSave()
	return persisterInstance
}
