/**
 * useLibrary — the sessions library for Vue pages: reactive lists, plus the session
 * actions with their toasts and Undo. The page reads its own copy of the library; every
 * change runs in the background worker, the library's only writer.
 */
import { computed, ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import { pluralize, timeAgo } from '@/lib/format'
import { openCopy as openCopyOf } from '@/lib/library/actions'
import { getLibrary, sendCommand } from '@/lib/library/client'
import type { MigrationResult } from '@/lib/library/migrate'
import type { SessionContent } from '@/lib/library/model'
import {
	HOME_ID,
	getCheckpoint,
	getCheckpointData,
	getLink,
	getOpenSessionId,
	getSession,
	getSessionData,
	isMigrated,
	lastUsed,
	listCheckpoints,
	listSessions,
	type Library,
	type SessionSummary,
} from '@/lib/library/store'
import type { Link } from '@/lib/library/state'

// ==================== Shared (per-document) state ====================

const lib = shallowRef<Library | null>(null)
const sessions = ref<SessionSummary[]>([])
const openId = ref('')
const migrated = ref(false)
const ready = ref(false)
/** Whether the open windows are the open session's tabs (`unlinked`: Chrome came back without them) */
const link = ref<Link>('unknown')
/** When `link` last changed */
const linkAt = ref(0)
/**
 * Unlinked for long enough that Chrome is not just slow restoring its windows, so the
 * person is asked to choose. Until then the state may still settle by itself.
 */
const needsChoice = ref(false)
/** Why the library could not open; '' when it did, or has not tried yet */
const openError = ref('')
/** Bumps on every library change, for views that read checkpoints */
const revision = ref(0)
let starting: Promise<Library> | null = null

/** How long Chrome gets to restore a session's windows before Papaya asks */
export const UNLINKED_GRACE_MS = 8_000
let graceTimer: ReturnType<typeof setTimeout> | undefined

function settleChoice(): void {
	clearTimeout(graceTimer)
	const unlinked = link.value === 'unlinked'
	const wait = linkAt.value + UNLINKED_GRACE_MS - Date.now()
	needsChoice.value = unlinked && wait <= 0
	if (unlinked && wait > 0) graceTimer = setTimeout(settleChoice, wait)
}

function refresh(): void {
	if (!lib.value) return
	sessions.value = listSessions(lib.value)
	openId.value = getOpenSessionId(lib.value)
	migrated.value = isMigrated(lib.value)
	link.value = getLink(lib.value)
	linkAt.value = lib.value.runtime.get().linkAt
	settleChoice()
	revision.value++
}

function start(): Promise<Library> {
	starting ??= getLibrary().then(
		(library) => {
			lib.value = library
			refresh()
			library.store.addTablesListener(refresh)
			library.store.addValuesListener(refresh)
			// The open session is this device's, and the link this browser run's, changed by the worker
			library.device.subscribe(refresh)
			library.runtime.subscribe(refresh)
			openError.value = ''
			ready.value = true
			return library
		},
		(error) => {
			// The library did not open (its upgrade failed, say); the next call tries again
			starting = null
			openError.value = errorText(error)
			throw error
		},
	)
	return starting
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const nameOf = (id: string) => (lib.value ? getSession(lib.value, id)?.name : null) ?? 'session'

/** A session's page: here, if this is the library's page; otherwise in a new tab (from the side panel) */
function showSession(id: string): void {
	const path = `#/sessions/${encodeURIComponent(id)}`
	if (location.hash.startsWith('#/panel') || location.hash.startsWith('#/popup')) {
		void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${path}`) })
	} else {
		location.hash = path
	}
}

/** What a switch did with open tabs that were not the session's */
function savedAsDescription(savedAs: string, fromId: string): string {
	return `The tabs that were open weren't part of ${nameOf(fromId)}, so Papaya saved them as a new session, “${nameOf(savedAs)}”.`
}

/** The window this page lives in (a side panel's window, or a tab's), where a group opens */
async function thisWindow(): Promise<number | undefined> {
	return (await chrome.windows.getCurrent().catch(() => null))?.id
}

// ==================== Composable ====================

export function useLibrary() {
	start().catch((error) => console.warn('[papaya] could not open the library', error))

	const openSession = computed(() => sessions.value.find((s) => s.id === openId.value) ?? null)
	/** The session the open windows belong to: the open one, or Home when none is */
	const currentSession = computed(
		() => sessions.value.find((s) => s.id === (openId.value || HOME_ID)) ?? null,
	)
	/**
	 * When the session the open windows belong to (Home when none is open) last changed:
	 * its tabs saved, or renamed. Autosave keeps it current while `link` is `linked`.
	 */
	const savedAt = computed(
		() => sessions.value.find((s) => s.id === (openId.value || HOME_ID))?.updatedAt ?? 0,
	)
	/** Sessions you can switch to: everything not open and not archived */
	const switchable = computed(() =>
		sessions.value.filter((s) => s.id !== openId.value && s.status !== 'archived'),
	)
	const archived = computed(() => sessions.value.filter((s) => s.status === 'archived'))
	// ---------- Saving groups as sessions ----------

	/** Undo saving a group: it reopens where it was, and the session it became goes */
	async function undoSaveGroup(sessionId: string, windowId: number): Promise<void> {
		try {
			const { failed } = await sendCommand('undoSaveGroup', { sessionId, windowId })
			if (failed.length)
				toast.warning(`Chrome wouldn't reopen ${pluralize(failed.length, 'tab')}`)
		} catch (error) {
			toast.error(`Couldn't bring it back: ${errorText(error)}`)
		}
	}

	/** Save an open tab group as a new closed session, and close its tabs */
	async function saveGroupAsSession(groupId: number): Promise<void> {
		try {
			const saved = await sendCommand('saveGroupAsSession', { groupId })
			toast(`Saved ${saved.name} as a session`, {
				description: 'Its tabs are closed. Open a copy of it to bring the group back.',
				action: {
					label: 'Undo',
					onClick: () => void undoSaveGroup(saved.sessionId, saved.windowId),
				},
				cancel: { label: 'Show it', onClick: () => showSession(saved.sessionId) },
			})
		} catch (error) {
			toast.error(`Couldn't save it: ${errorText(error)}`)
		}
	}

	/** Save several open groups as sessions, one each */
	async function saveGroupsAsSessions(groupIds: number[]): Promise<void> {
		const saved = await sendCommand('saveGroupsAsSessions', { groupIds })
		if (!saved.length) {
			toast.error("Couldn't save those groups")
			return
		}
		toast(`Saved ${pluralize(saved.length, 'group')} as sessions`, {
			description: 'Their tabs are closed. Each is in Sessions under its own name.',
			action: {
				label: 'Undo',
				onClick: async () => {
					for (const s of [...saved].reverse())
						await undoSaveGroup(s.sessionId, s.windowId)
				},
			},
		})
	}

	async function switchTo(id: string): Promise<void> {
		try {
			const result = await sendCommand('switchTo', { sessionId: id })
			if (!result) return
			const { savedAs } = result
			toast(`Switched to ${nameOf(id)}`, {
				...(savedAs
					? {
							description: savedAsDescription(savedAs, result.fromId),
							action: { label: 'Show it', onClick: () => showSession(savedAs) },
							duration: 10_000,
						}
					: {
							description: `${nameOf(result.fromId)} was saved as you left it.`,
							action: { label: 'Undo', onClick: () => void switchTo(result.fromId) },
						}),
			})
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't switch: ${errorText(error)}`)
		}
	}

	/** A checkpoint of the open session, made on purpose */
	async function saveCheckpoint(): Promise<void> {
		const library = await start()
		try {
			const id = await sendCommand('saveCheckpoint')
			const name = nameOf(getOpenSessionId(library) || HOME_ID)
			if (id)
				toast(`Saved a checkpoint of ${name}`, {
					description: `You can go back to it from ${name}'s History.`,
				})
			else toast(`${name} has no tabs to keep yet`)
		} catch (error) {
			toast.error(`Couldn't save a checkpoint: ${errorText(error)}`)
		}
	}

	/** Unlinked: open the open session's saved tabs next to what's open */
	async function reopenSaved(): Promise<void> {
		const name = currentName()
		try {
			const { failed } = await sendCommand('reopenSaved')
			toast(`Reopened ${name}`, { description: `Papaya is saving ${name} again.` })
			if (failed.length)
				toast.warning(`Chrome wouldn't reopen ${pluralize(failed.length, 'tab')}`)
		} catch (error) {
			toast.error(`Couldn't reopen its tabs: ${errorText(error)}`)
		}
	}

	/** Unlinked: what's open becomes the open session's tabs; what it had is kept as a checkpoint */
	async function keepOpen(): Promise<void> {
		const name = currentName()
		try {
			await sendCommand('keepOpen')
			toast(`${name} now has the tabs that are open`, {
				description: 'The tabs it had are kept in its History.',
			})
		} catch (error) {
			toast.error(`Couldn't keep what's open: ${errorText(error)}`)
		}
	}

	const currentName = () => nameOf(openId.value || HOME_ID)

	async function saveOpenAs(name: string): Promise<string> {
		const id = await sendCommand('saveOpenAs', { name })
		toast(`Your open tabs are now the session ${name}`)
		return id
	}

	/** Save open tabs (all, or the given ids) as a new closed session; they stay open */
	async function saveCopy(
		name?: string,
		tabIds?: number[],
		options: { quiet?: boolean } = {},
	): Promise<string> {
		const library = await start()
		const id = await sendCommand('saveCopy', { name, tabIds })
		const session = getSession(library, id)!
		if (!options.quiet)
			toast(`Saved ${pluralize(session.tabCount, 'tab')} as ${session.name}`, {
				description: 'Your tabs stay open.',
				action: { label: 'Show it', onClick: () => showSession(id) },
			})
		return id
	}

	/** From Home: what's open becomes a new closed session, and Home carries on empty */
	async function startFresh(): Promise<void> {
		const library = await start()
		try {
			const { id, failed } = await sendCommand('startFresh', {})
			const session = getSession(library, id)
			toast(`Saved ${pluralize(session?.tabCount ?? 0, 'tab')} as ${nameOf(id)}`, {
				description: 'Home is empty now. Reopen switches to the new session.',
				action: { label: 'Reopen', onClick: () => void switchTo(id) },
				cancel: { label: 'Show it', onClick: () => showSession(id) },
				duration: 15_000,
			})
			if (failed.length)
				toast.warning(`Chrome wouldn't reopen ${pluralize(failed.length, 'tab')}`)
		} catch (error) {
			toast.error(`Couldn't start fresh: ${errorText(error)}`)
		}
	}

	async function putAway(): Promise<void> {
		const library = await start()
		const leaving = getOpenSessionId(library)
		try {
			const result = await sendCommand('putAway')
			if (!result) return
			const { savedAs } = result
			toast(
				`Put ${nameOf(leaving)} away`,
				savedAs
					? {
							description: savedAsDescription(savedAs, leaving),
							action: { label: 'Show it', onClick: () => showSession(savedAs) },
							duration: 10_000,
						}
					: {
							description: 'Its tabs are saved as you left them.',
							action: { label: 'Undo', onClick: () => void switchTo(leaving) },
						},
			)
		} catch (error) {
			toast.error(`Couldn't put it away: ${errorText(error)}`)
		}
	}

	/**
	 * Opens tabs only; the library does not change, so this stays in the page. A session
	 * that is one group opens as that group in this page's window.
	 */
	async function openCopy(id: string, checkpointId?: string): Promise<void> {
		const library = await start()
		try {
			const result = await openCopyOf(library, id, checkpointId, await thisWindow())
			if (result?.failed.length)
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
		} catch (error) {
			toast.error(`Couldn't open it: ${errorText(error)}`)
		}
	}

	async function moveTabs(
		tabIds: number[],
		target: { sessionId: string } | { name: string },
	): Promise<void> {
		try {
			const id = await sendCommand('moveTabs', { tabIds, target })
			toast(`Moved ${pluralize(tabIds.length, 'tab')} to ${nameOf(id)}`, {
				action: { label: 'Open a copy', onClick: () => void openCopy(id) },
			})
		} catch (error) {
			toast.error(`Couldn't move them: ${errorText(error)}`)
		}
	}

	/** A session from a file: a new closed session with these tabs */
	async function createSession(
		fields: { name: string; description?: string },
		data?: SessionContent,
	): Promise<string> {
		return sendCommand('createSession', { fields, data })
	}

	async function rename(id: string, name: string): Promise<void> {
		await sendCommand('updateSession', { id, fields: { name } })
	}

	async function setNotes(id: string, description: string): Promise<void> {
		await sendCommand('updateSession', { id, fields: { description } })
	}

	async function archive(id: string): Promise<void> {
		await sendCommand('setStatus', { id, status: 'archived' })
		toast(`Archived ${nameOf(id)}`, {
			action: {
				label: 'Undo',
				onClick: () => void sendCommand('setStatus', { id, status: 'closed' }),
			},
		})
	}

	async function unarchive(id: string): Promise<void> {
		await sendCommand('setStatus', { id, status: 'closed' })
	}

	async function remove(id: string): Promise<void> {
		await start()
		const name = nameOf(id)
		await sendCommand('deleteSession', { id })
		toast(`Deleted ${name}`)
	}

	/**
	 * Go back to a checkpoint. For the session the open windows belong to, they are
	 * replaced with its tabs, as in a switch.
	 */
	async function restoreCheckpoint(id: string, checkpointId: string): Promise<void> {
		const library = await start()
		const when = timeAgo(getCheckpoint(library, checkpointId)?.createdAt ?? 0)
		try {
			const result = await sendCommand('restoreCheckpoint', { sessionId: id, checkpointId })
			const { savedAs } = result
			toast(
				when && when !== 'just now'
					? `${nameOf(id)} is back to how it was ${when}`
					: `Restored ${nameOf(id)}`,
				savedAs
					? {
							description: savedAsDescription(savedAs, id),
							action: { label: 'Show it', onClick: () => showSession(savedAs) },
							duration: 10_000,
						}
					: {
							description: result.reopened
								? 'The tabs that were open are kept in its History.'
								: 'What it had is kept in its History.',
						},
			)
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't restore it: ${errorText(error)}`)
		}
	}

	/** Replace a closed session's tabs with an edited copy; rejects if it could not */
	async function saveEdits(id: string, data: SessionContent): Promise<void> {
		await sendCommand('saveEdits', { sessionId: id, data })
	}

	/** The move-in: this page planned it from the old stores; the worker applies it */
	async function applyMove(result: MigrationResult): Promise<void> {
		await sendCommand('moveIn', { plan: result })
	}

	return {
		ready,
		migrated,
		sessions,
		openSession,
		switchable,
		archived,
		revision,
		link,
		needsChoice,
		openError,
		/** Try opening the library again after it failed; a new failure lands in `openError` */
		retry: () =>
			start().then(
				() => undefined,
				() => undefined,
			),
		currentSession,
		savedAt,
		homeId: HOME_ID,
		lastUsed,
		library: () => start(),
		getData: async (id: string) => getSessionData(await start(), id),
		/** The tabs in a stored entry: a session's content or a checkpoint */
		getContent: async (entryId: string) => getCheckpointData(await start(), entryId),
		/** A session's checkpoints, newest first (its content is not one of them) */
		listCheckpoints: (id: string) => (lib.value ? listCheckpoints(lib.value, id) : []),
		switchTo,
		saveCheckpoint,
		reopenSaved,
		keepOpen,
		saveOpenAs,
		saveCopy,
		putAway,
		startFresh,
		openCopy,
		moveTabs,
		createSession,
		rename,
		setNotes,
		archive,
		unarchive,
		remove,
		restoreCheckpoint,
		saveEdits,
		applyMove,
		saveGroupAsSession,
		saveGroupsAsSessions,
	}
}
