/**
 * Opening the library from chrome.storage: the background worker opens the one copy
 * that writes; pages open copies that follow it and cannot write.
 */
import type { MergeableStore } from 'tinybase'
import { chromeBlobs } from './blobs'
import { INDEX_KEY, followLibraryIndex, startLibraryPersistence } from './persist'
import { chromeDevice } from './state'
import { createLibrary, type Library } from './store'
import { keepIndexCopy, upgradeLibrary } from './upgrade'

export interface WriterLibrary {
	lib: Library
	/** Save the index now; resolves once it is stored */
	save(): Promise<void>
}

/**
 * The worker's library, brought up to the current schema before anything reads it. The
 * index is read as stored first, since saving rewrites it. If the upgrade fails this
 * rejects and nothing is saved, so new code never runs on an index it could not
 * upgrade; opening again tries again.
 */
export async function openLibrary(): Promise<WriterLibrary> {
	const stored = (await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY]
	const lib = createLibrary(chromeBlobs(), await chromeDevice())
	const persister = await startLibraryPersistence(lib.store, () =>
		upgradeLibrary(lib, { keepCopy: () => keepIndexCopy(stored) }),
	)
	return {
		lib,
		save: async () => {
			await persister.save()
		},
	}
}

export interface PageLibrary {
	lib: Library
	/** Merge what the worker has stored into this copy now, rather than when Chrome says */
	pull(): Promise<void>
}

/**
 * A page's copy of the library. It follows what the worker saves and cannot write: its
 * index never saves, and changing it, its saved tabs or its device state throws. Open
 * it only once the worker has opened (and upgraded) the library.
 */
export async function followLibrary(): Promise<PageLibrary> {
	const lib = createLibrary(
		chromeBlobs({ readOnly: true }),
		await chromeDevice({ readOnly: true }),
	)
	const index = await followLibraryIndex(lib.store)
	return {
		lib: { ...lib, store: readOnlyStore(lib.store) },
		async pull() {
			await Promise.all([index.pull(), lib.device.refresh()])
		},
	}
}

/** Store methods that change it; anything else (reads, listeners) a page may use */
const isWrite = (method: string) =>
	method !== 'delListener' &&
	/^(set|del|apply|merge|addRow$|transaction$|startTransaction$|finishTransaction$)/.test(method)

function readOnlyStore(store: MergeableStore): MergeableStore {
	const methods = Object.entries(store).map(([method, fn]) => [
		method,
		isWrite(method)
			? () => {
					throw new Error(
						`A page cannot change the library (${method}); ask the background worker`,
					)
				}
			: fn,
	])
	return Object.freeze(Object.fromEntries(methods)) as MergeableStore
}
