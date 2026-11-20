/**
 * Keep the library index in chrome.storage.local, shared by every extension page and
 * the background worker.
 *
 * The worker saves its whole index after each write that changed it; pages only follow
 * it. Every copy merges (never replaces) whatever was saved: Chrome tells every page and
 * the worker when the entry changes. If merging leaves the saving copy with something
 * the saved one lacks (two copies wrote at once), it saves again, so the stored index
 * always ends up with both changes.
 */
import { createCustomPersister } from 'tinybase/persisters'
import type { MergeableChanges, MergeableContent, MergeableStore } from 'tinybase'

export const INDEX_KEY = 'library:index'

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void

/** Tables and values hashes, which differ whenever the contents differ */
const hashes = (content: MergeableContent | undefined) =>
	content ? `${content[0]?.[2]}:${content[1]?.[2]}` : ''

/** The trailing 1 marks stored content as changes, which TinyBase merges */
const asChanges = (content: MergeableContent) => [...content, 1] as unknown as MergeableChanges

/**
 * Load the stored index into the store, then save every change. `beforeSaving` runs
 * once the stored index has loaded and before anything is saved (the upgrade); if it
 * fails, nothing is saved and the store stops following storage.
 *
 * Without `autoSave`, changes are saved only when asked (`persister.save()`), so a
 * writer that changes the store in several steps stores it once; what `beforeSaving`
 * changed is saved before this resolves.
 */
export async function startLibraryPersistence(
	store: MergeableStore,
	beforeSaving?: () => Promise<void>,
	options: { autoSave?: boolean } = {},
) {
	let saving = false
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
				listener(undefined, asChanges(saved) as Parameters<typeof listener>[1])
				if (saving && hashes(saved) !== hashes(store.getMergeableContent()))
					void persister?.save()
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
	const loaded = store.getMergeableContentHashes().join()
	try {
		await beforeSaving?.()
	} catch (error) {
		await persisterInstance.destroy()
		throw error
	}
	saving = true
	if (options.autoSave ?? true) await persisterInstance.startAutoSave()
	else if (store.getMergeableContentHashes().join() !== loaded) await persisterInstance.save()
	return persisterInstance
}

/**
 * Follow the stored index without ever saving it, as a page does: load it into a fresh
 * store, then merge every later change, and what is stored whenever asked (`pull`).
 * Merging keeps anything this copy already has that is newer, so a late or repeated
 * merge never takes the copy backwards.
 *
 * The first load replaces instead, as TinyBase's own persisters do: a fresh store
 * already holds the schema's default values, stamped as it was created, and a merge
 * would let those defaults win over older stored values.
 */
export async function followLibraryIndex(store: MergeableStore) {
	const read = async () => (await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY]
	const merge = (saved: unknown) => {
		if (!Array.isArray(saved)) return
		const content = saved as MergeableContent
		if (hashes(content) !== hashes(store.getMergeableContent()))
			store.applyMergeableChanges(asChanges(content))
	}
	const onChanged: StorageListener = (changes, area) => {
		if (area === 'local' && INDEX_KEY in changes) merge(changes[INDEX_KEY].newValue)
	}

	const first = await read()
	if (Array.isArray(first)) store.setMergeableContent(first as MergeableContent)
	chrome.storage.onChanged.addListener(onChanged)
	const pull = async () => merge(await read())
	// Anything saved between the first read and listening
	await pull()
	return { pull, stop: () => chrome.storage.onChanged.removeListener(onChanged) }
}
