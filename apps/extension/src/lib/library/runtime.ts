/**
 * The library for this page or the background worker: opened once, kept in sync with
 * every other copy through chrome.storage.
 */
import { chromeBlobs } from './blobs'
import { INDEX_KEY, startLibraryPersistence } from './persist'
import { chromeDevice } from './state'
import { createLibrary, type Library } from './store'
import { keepIndexCopy, upgradeLibrary } from './upgrade'

let opening: Promise<Library> | null = null

/**
 * Load the library and bring it up to the current schema before anything reads it. The
 * index is read as stored first, since saving starts as soon as it loads.
 */
export async function openLibrary(): Promise<Library> {
	const stored = (await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY]
	const lib = createLibrary(chromeBlobs(), await chromeDevice())
	await startLibraryPersistence(lib.store)
	try {
		await upgradeLibrary(lib, { keepCopy: () => keepIndexCopy(stored) })
	} catch (error) {
		// Nothing was lost; the next time the library opens it tries again
		console.warn('[papaya] could not upgrade the library', error)
	}
	return lib
}

export function getLibrary(): Promise<Library> {
	opening ??= openLibrary()
	return opening
}
