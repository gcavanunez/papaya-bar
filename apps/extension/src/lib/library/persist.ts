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

type Stamped = [unknown, ...unknown[]]
type Stamps<T> = [Record<string, T>, ...unknown[]]
const revive = ([value, ...stamps]: Stamped): Stamped => [value ?? undefined, ...stamps]
const each = <T, U>([things, ...stamps]: Stamps<T>, change: (thing: T) => U): Stamps<U> => [
	Object.fromEntries(Object.entries(things ?? {}).map(([id, thing]) => [id, change(thing)])),
	...stamps,
]

/**
 * An index as TinyBase wrote it, from what was stored. chrome.storage keeps JSON, which
 * turns TinyBase's mark for a deleted cell or value (`undefined`) into `null`, and TinyBase
 * reads a `null` cell that has a default as that default: a deleted session would come
 * back as an empty one, named ''. No schema here allows `null`, so each `null` is a
 * deletion again. Backup files are JSON too, and read the same way.
 */
export function fromStored(stored: unknown): MergeableContent | undefined {
	if (!Array.isArray(stored) || !Array.isArray(stored[0]) || !Array.isArray(stored[1]))
		return undefined
	const [tables, values] = stored as [Stamps<Stamps<Stamps<Stamped>>>, Stamps<Stamped>]
	return [
		each(tables, (table) => each(table, (row) => each(row, revive))),
		each(values, revive),
	] as unknown as MergeableContent
}

/**
 * Load the stored index into the store, then save every change. `beforeSaving` runs
 * once the stored index has loaded and before anything is saved (the upgrade); if it
 * fails, nothing is saved and the store stops following storage.
 *
 * Without `autoSave`, the caller stores changes itself with `writeIndex`, so a writer
 * that changes the store in several steps stores it once and knows whether it was
 * stored; what `beforeSaving` changed is stored before this resolves, or this rejects.
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
		async () => fromStored((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY]),
		async (getContent) => {
			await chrome.storage.local.set({ [INDEX_KEY]: getContent() })
		},
		(listener) => {
			const onChanged: StorageListener = (changes, area) => {
				const saved = fromStored(changes[INDEX_KEY]?.newValue)
				if (area !== 'local' || !saved) return
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
	const autoSave = options.autoSave ?? true
	try {
		await beforeSaving?.()
		if (!autoSave && store.getMergeableContentHashes().join() !== loaded)
			await writeIndex(store)
	} catch (error) {
		await persisterInstance.destroy()
		throw error
	}
	saving = true
	if (autoSave) await persisterInstance.startAutoSave()
	return persisterInstance
}

/**
 * Store the whole index now. Unlike a TinyBase persister's `save()`, which reports
 * success whatever happened (a failed write only reaches its error handler, a save
 * asked for while it loads is skipped, and one asked for while it is busy resolves
 * before it is written), this resolves only once the index is stored, and rejects if
 * it could not be.
 */
export async function writeIndex(store: MergeableStore): Promise<void> {
	try {
		await chrome.storage.local.set({ [INDEX_KEY]: store.getMergeableContent() })
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Papaya could not save your sessions (${reason}). It will try again with the next change.`,
		)
	}
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
		const content = fromStored(saved)
		if (content && hashes(content) !== hashes(store.getMergeableContent()))
			store.applyMergeableChanges(asChanges(content))
	}
	const onChanged: StorageListener = (changes, area) => {
		if (area === 'local' && INDEX_KEY in changes) merge(changes[INDEX_KEY].newValue)
	}

	const first = fromStored(await read())
	if (first) store.setMergeableContent(first)
	chrome.storage.onChanged.addListener(onChanged)
	const pull = async () => merge(await read())
	// Anything saved between the first read and listening
	await pull()
	return { pull, stop: () => chrome.storage.onChanged.removeListener(onChanged) }
}
