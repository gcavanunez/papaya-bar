/**
 * The library for this page or the background worker: opened once, kept in sync with
 * every other copy through chrome.storage.
 */
import { chromeBlobs } from './blobs'
import { startLibraryPersistence } from './persist'
import { createLibrary, type Library } from './store'

let opening: Promise<Library> | null = null

export function getLibrary(): Promise<Library> {
	opening ??= (async () => {
		const lib = createLibrary(chromeBlobs())
		await startLibraryPersistence(lib.store)
		return lib
	})()
	return opening
}
