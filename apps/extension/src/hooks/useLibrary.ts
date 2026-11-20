/**
 * useLibrary — the sessions library for Vue pages: reactive lists, plus the session
 * actions with their toasts and Undo. The page reads its own copy of the library; every
 * change runs in the background worker, the library's only writer.
 */
import { computed, ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import { pluralize } from '@/lib/format'
import { openCopy as openCopyOf } from '@/lib/library/actions'
import { getLibrary, sendCommand } from '@/lib/library/client'
import type { MigrationResult } from '@/lib/library/migrate'
import type { SessionContent } from '@/lib/library/model'
import {
	HOME_ID,
	getCheckpointData,
	getLink,
	getOpenSessionId,
	getSession,
	getSessionData,
	getStashed,
	getStashedTabs,
	isMigrated,
	lastUsed,
	listCheckpoints,
	listSessions,
	listStashed,
	type Library,
	type SessionSummary,
	type StashedGroup,
} from '@/lib/library/store'
import type { Link } from '@/lib/library/state'

// ==================== Shared (per-document) state ====================

const lib = shallowRef<Library | null>(null)
const sessions = ref<SessionSummary[]>([])
/** Every session's stashed groups */
const stashedAll = ref<StashedGroup[]>([])
const openId = ref('')
const migrated = ref(false)
const ready = ref(false)
/** Whether the open windows are the open session's tabs (`unlinked`: Chrome came back without them) */
const link = ref<Link>('unknown')
/** Bumps on every library change, for views that read checkpoints */
const revision = ref(0)
let starting: Promise<Library> | null = null

function refresh(): void {
	if (!lib.value) return
	sessions.value = listSessions(lib.value)
	stashedAll.value = listStashed(lib.value)
	openId.value = getOpenSessionId(lib.value)
	migrated.value = isMigrated(lib.value)
	link.value = getLink(lib.value)
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
			ready.value = true
			return library
		},
		(error) => {
			// The library did not open (its upgrade failed, say); the next call tries again
			starting = null
			throw error
		},
	)
	return starting
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const nameOf = (id: string) => (lib.value ? getSession(lib.value, id)?.name : null) ?? 'session'

/** The window this page lives in (a side panel's window, or a tab's), where groups reopen */
async function thisWindow(): Promise<number | undefined> {
	return (await chrome.windows.getCurrent().catch(() => null))?.id
}

// ==================== Composable ====================

export function useLibrary() {
	start().catch((error) => console.warn('[papaya] could not open the library', error))

	const openSession = computed(() => sessions.value.find((s) => s.id === openId.value) ?? null)
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
	/** Groups stashed in the open session (Home's when nothing else is open) */
	const stashed = computed(() =>
		stashedAll.value.filter((g) => g.sessionId === (openId.value || HOME_ID)),
	)
	const stashedCount = (sessionId: string) =>
		stashedAll.value.filter((g) => g.sessionId === sessionId).length

	// ---------- Stashing groups ----------

	async function stashGroup(groupId: number): Promise<void> {
		try {
			const result = await sendCommand('stashGroup', { groupId })
			toast(`Stashed ${result.name}`, {
				action: {
					label: 'Undo',
					onClick: () => void openStashed(result.stashId, result.windowId),
				},
			})
		} catch (error) {
			toast.error(`Couldn't stash it: ${errorText(error)}`)
		}
	}

	async function stashGroups(groupIds: number[]): Promise<void> {
		const results = await sendCommand('stashGroups', { groupIds })
		if (!results.length) return
		toast(`Stashed ${pluralize(results.length, 'group')}`, {
			action: {
				label: 'Undo',
				onClick: async () => {
					for (const r of [...results].reverse()) await openStashed(r.stashId, r.windowId)
				},
			},
		})
	}

	async function openStashed(stashId: string, windowId?: number): Promise<void> {
		try {
			const result = await sendCommand('openStashed', {
				stashId,
				windowId: windowId ?? (await thisWindow()),
			})
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't open it: ${errorText(error)}`)
		}
	}

	/** Open a stashed group and stash the group you were in */
	async function swapToStashed(stashId: string): Promise<void> {
		try {
			const window = await thisWindow()
			const { stashed: left } = await sendCommand('swapToStashed', {
				stashId,
				windowId: window,
			})
			if (left) {
				toast(`Stashed ${left.name}`, {
					action: { label: 'Undo', onClick: () => void swapToStashed(left.stashId) },
				})
			}
		} catch (error) {
			toast.error(`Couldn't swap: ${errorText(error)}`)
		}
	}

	/** Focus an open group and stash the group you were in */
	async function swapToGroup(groupId: number): Promise<void> {
		try {
			const { stashed: left } = await sendCommand('swapToGroup', { groupId })
			if (left) {
				toast(`Stashed ${left.name}`, {
					action: { label: 'Undo', onClick: () => void swapToStashed(left.stashId) },
				})
			}
		} catch (error) {
			toast.error(`Couldn't swap: ${errorText(error)}`)
		}
	}

	async function renameStashed(stashId: string, name: string): Promise<void> {
		await sendCommand('updateStashed', { id: stashId, fields: { name } })
	}

	async function moveStashed(stashId: string, sessionId: string): Promise<void> {
		const library = await start()
		const group = getStashed(library, stashId)
		if (!group) return
		await sendCommand('updateStashed', { id: stashId, fields: { sessionId } })
		toast(`Moved ${group.name} to ${nameOf(sessionId)}`, {
			action: {
				label: 'Undo',
				onClick: () =>
					void sendCommand('updateStashed', {
						id: stashId,
						fields: { sessionId: group.sessionId },
					}),
			},
		})
	}

	async function deleteStashed(stashId: string): Promise<void> {
		const library = await start()
		const group = getStashed(library, stashId)
		if (!group) return
		const tabs = await getStashedTabs(library, stashId)
		await sendCommand('removeStashed', { id: stashId })
		toast(`Deleted ${group.name} and its ${pluralize(tabs.length, 'tab')}`, {
			action: {
				label: 'Undo',
				onClick: () =>
					void sendCommand('addStashed', {
						sessionId: group.sessionId,
						group: { name: group.name, color: group.color },
						tabs,
						createdAt: group.createdAt,
					}),
			},
		})
	}

	async function switchTo(id: string): Promise<void> {
		try {
			const result = await sendCommand('switchTo', { sessionId: id })
			if (!result) return
			toast(`Switched to ${nameOf(id)}`, {
				description: result.savedAs
					? `Your open tabs were saved as ${nameOf(result.savedAs)}.`
					: `${nameOf(result.fromId)} was saved as you left it.`,
				action: { label: 'Undo', onClick: () => void switchTo(result.fromId) },
			})
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't switch: ${errorText(error)}`)
		}
	}

	/** A checkpoint of the open session, made by hand */
	async function saveVersion(): Promise<void> {
		const library = await start()
		const id = await sendCommand('saveCheckpoint')
		const name = nameOf(getOpenSessionId(library) || HOME_ID)
		if (id) toast(`Saved a version of ${name}`)
		else toast(`${name} has no tabs to save`)
	}

	/** Unlinked: open the open session's saved tabs next to what's open */
	async function reopenSaved(): Promise<void> {
		try {
			const { failed } = await sendCommand('reopenSaved')
			if (failed.length)
				toast.warning(`Chrome wouldn't reopen ${pluralize(failed.length, 'tab')}`)
		} catch (error) {
			toast.error(`Couldn't reopen them: ${errorText(error)}`)
		}
	}

	/** Unlinked: what's open becomes the open session's tabs; what it had is kept as a checkpoint */
	async function keepOpen(): Promise<void> {
		try {
			await sendCommand('keepOpen')
		} catch (error) {
			toast.error(`Couldn't save them: ${errorText(error)}`)
		}
	}

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
			})
		return id
	}

	async function putAway(): Promise<void> {
		const library = await start()
		const leaving = getOpenSessionId(library)
		try {
			const result = await sendCommand('putAway')
			if (!result) return
			toast(`Put ${nameOf(leaving)} away`, {
				action: { label: 'Undo', onClick: () => void switchTo(leaving) },
			})
		} catch (error) {
			toast.error(`Couldn't put it away: ${errorText(error)}`)
		}
	}

	/** Opens tabs only; the library does not change, so this stays in the page */
	async function openCopy(id: string, checkpointId?: string): Promise<void> {
		const library = await start()
		const result = await openCopyOf(library, id, checkpointId)
		if (result?.failed.length)
			toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
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
	async function restoreOlder(id: string, checkpointId: string): Promise<void> {
		try {
			const result = await sendCommand('restoreCheckpoint', { sessionId: id, checkpointId })
			toast(`Restored an older version of ${nameOf(id)}`, {
				description: 'The version it replaced is still in the list.',
			})
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't restore it: ${errorText(error)}`)
		}
	}

	/** Save edits to a closed session's tabs */
	async function saveEdits(id: string, data: SessionContent): Promise<void> {
		await sendCommand('saveEdits', { sessionId: id, data })
		toast(`Saved your changes to ${nameOf(id)}`, {
			description: 'The previous version is still in the list.',
		})
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
		stashed,
		stashedAll,
		stashedCount,
		revision,
		link,
		savedAt,
		homeId: HOME_ID,
		lastUsed,
		library: () => start(),
		getData: async (id: string) => getSessionData(await start(), id),
		/** The tabs in a stored entry: a session's content or a checkpoint */
		getVersionData: async (entryId: string) => getCheckpointData(await start(), entryId),
		/** A session's checkpoints, newest first (its content is not one of them) */
		listCheckpoints: (id: string) => (lib.value ? listCheckpoints(lib.value, id) : []),
		switchTo,
		saveVersion,
		reopenSaved,
		keepOpen,
		saveOpenAs,
		saveCopy,
		putAway,
		openCopy,
		moveTabs,
		createSession,
		rename,
		setNotes,
		archive,
		unarchive,
		remove,
		restoreOlder,
		saveEdits,
		applyMove,
		stashGroup,
		stashGroups,
		openStashed,
		swapToStashed,
		swapToGroup,
		renameStashed,
		moveStashed,
		deleteStashed,
		getStashedTabs: async (stashId: string) => getStashedTabs(await start(), stashId),
	}
}
