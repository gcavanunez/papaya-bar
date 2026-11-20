/**
 * Autosave: the open session saves itself as its tabs change, so nothing depends on
 * switching away or remembering to save.
 *
 * Browser events only start a wait. The save itself (a tick) is a write like any other:
 * it runs on the library writer's queue, never during an action. A tick reads everything
 * it needs from what is stored and from the browser, so a worker Chrome stopped and
 * started again carries on where the last one left off. Every wait stays well under the
 * 30 seconds after which Chrome may stop an idle worker.
 *
 * `background.js` registers the browser listeners and calls in here.
 */
import { captureOpen, saveLinked } from './actions'
import {
	ensureHome,
	getOpenSessionId,
	getSession,
	isMigrated,
	setLink,
	type Library,
} from './store'
import type { LibraryWriter } from './writer'

/** A change saves after this long without another */
export const QUIET_MS = 2_000
/** ...and at most this long after the first change, however busy the browser is */
export const MAX_WAIT_MS = 10_000
/** A tab's title or icon changing saves after this long without another change */
export const RETITLE_QUIET_MS = 15_000

export type TickResult =
	/** The library has not been moved in yet */
	| 'not-moved-in'
	/** No normal window is open: nothing to save, and whether one is linked is unknown */
	| 'no-window'
	/** The device's open session is not in the library */
	| 'no-session'
	/** What's open is not the open session's: nothing saved */
	| 'unlinked'
	/** Saved already: nothing written */
	| 'unchanged'
	| 'saved'

/**
 * One autosave: decide whether what's open is the open session's (unless it already is
 * known to be), and if so save exactly what's open as its content. Writes nothing to
 * storage when nothing changed.
 */
export async function autosaveTick(lib: Library, now = Date.now()): Promise<TickResult> {
	if (!isMigrated(lib)) return 'not-moved-in'
	const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
	if (!windows.length) {
		await setLink(lib, 'unknown', now)
		return 'no-window'
	}
	const sessionId = getOpenSessionId(lib) || ensureHome(lib, now)
	if (!getSession(lib, sessionId)) return 'no-session'
	const { linked, changed } = await saveLinked(
		lib,
		sessionId,
		await captureOpen(),
		'autosave',
		now,
	)
	return !linked ? 'unlinked' : changed ? 'saved' : 'unchanged'
}

export interface Autosaver {
	/** Tabs, groups or windows changed: save after QUIET_MS of quiet, within MAX_WAIT_MS */
	changed(): void
	/** A title or icon changed: save after RETITLE_QUIET_MS of quiet */
	retitled(): void
	/** For chrome.tabs.onUpdated: which of the two it is, or neither */
	tabUpdated(change: chrome.tabs.OnUpdatedInfo): void
	/** Save now, on the writer's queue; the worker runs one when it starts */
	tick(): Promise<TickResult>
}

export function createAutosaver(writer: Pick<LibraryWriter, 'enqueue'>): Autosaver {
	let timer: ReturnType<typeof setTimeout> | null = null
	/** When the first change still waiting to be saved happened; 0 when none is */
	let firstChange = 0

	const tick = () => writer.enqueue((lib) => autosaveTick(lib))

	function saveAt(at: number) {
		if (timer) clearTimeout(timer)
		timer = setTimeout(
			() => {
				timer = null
				firstChange = 0
				tick().catch((error) => console.warn('[papaya] autosave', error))
			},
			Math.max(0, at - Date.now()),
		)
	}

	function changed() {
		const now = Date.now()
		firstChange ||= now
		saveAt(Math.min(now + QUIET_MS, firstChange + MAX_WAIT_MS))
	}

	function retitled() {
		// A save is already coming, and it captures titles too
		if (firstChange) return
		saveAt(Date.now() + RETITLE_QUIET_MS)
	}

	function tabUpdated(change: chrome.tabs.OnUpdatedInfo) {
		if ('url' in change || 'groupId' in change || 'pinned' in change) changed()
		else if ('title' in change || 'favIconUrl' in change) retitled()
	}

	return { changed, retitled, tabUpdated, tick }
}
