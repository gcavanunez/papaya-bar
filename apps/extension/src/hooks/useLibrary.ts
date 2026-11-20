/**
 * useLibrary — the sessions library for Vue pages: reactive lists, plus the session
 * actions with their toasts and Undo. The actions themselves live in lib/library.
 */
import { computed, ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import { pluralize } from '@/lib/format'
import * as actions from '@/lib/library/actions'
import * as stash from '@/lib/library/stash'
import type { MigrationResult } from '@/lib/library/migrate'
import type { VersionData } from '@/lib/library/model'
import { getLibrary } from '@/lib/library/runtime'
import {
	HOME_ID,
	addStashed,
	addVersion,
	deleteSession,
	getOpenSessionId,
	getSession,
	getSessionData,
	getStashed,
	getStashedTabs,
	getVersionData,
	isMigrated,
	lastUsed,
	listSessions,
	listStashed,
	listVersions,
	removeStashed,
	restoreVersion,
	setStatus,
	updateSession,
	updateStashed,
	type Library,
	type SessionSummary,
	type StashedGroup,
} from '@/lib/library/store'

// ==================== Shared (per-document) state ====================

const lib = shallowRef<Library | null>(null)
const sessions = ref<SessionSummary[]>([])
/** Every session's stashed groups */
const stashedAll = ref<StashedGroup[]>([])
const openId = ref('')
const migrated = ref(false)
const ready = ref(false)
/** Bumps on every library change, for views that read versions */
const revision = ref(0)
let starting: Promise<Library> | null = null

function refresh(): void {
	if (!lib.value) return
	sessions.value = listSessions(lib.value)
	stashedAll.value = listStashed(lib.value)
	openId.value = getOpenSessionId(lib.value)
	migrated.value = isMigrated(lib.value)
	revision.value++
}

function start(): Promise<Library> {
	starting ??= getLibrary().then((library) => {
		lib.value = library
		refresh()
		library.store.addTablesListener(refresh)
		library.store.addValuesListener(refresh)
		// The open session is this device's, changed by any page or the worker
		library.device.subscribe(refresh)
		ready.value = true
		return library
	})
	return starting
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const nameOf = (id: string) => getSession(lib.value!, id)?.name ?? 'session'

/** The window this page lives in (a side panel's window, or a tab's), where groups reopen */
async function thisWindow(): Promise<number | undefined> {
	return (await chrome.windows.getCurrent().catch(() => null))?.id
}

// ==================== Composable ====================

export function useLibrary() {
	void start()

	const openSession = computed(() => sessions.value.find((s) => s.id === openId.value) ?? null)
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
		const library = await start()
		try {
			const result = await stash.stashGroup(library, groupId)
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
		const library = await start()
		const results = await stash.stashGroups(library, groupIds)
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
		const library = await start()
		try {
			const result = await stash.openStashed(
				library,
				stashId,
				windowId ?? (await thisWindow()),
			)
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't open it: ${errorText(error)}`)
		}
	}

	/** Open a stashed group and stash the group you were in */
	async function swapToStashed(stashId: string): Promise<void> {
		const library = await start()
		try {
			const window = await thisWindow()
			const { stashed: left } = await stash.swapToStashed(library, stashId, window)
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
		const library = await start()
		try {
			const { stashed: left } = await stash.swapToGroup(library, groupId)
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
		updateStashed(await start(), stashId, { name })
	}

	async function moveStashed(stashId: string, sessionId: string): Promise<void> {
		const library = await start()
		const group = getStashed(library, stashId)
		if (!group) return
		updateStashed(library, stashId, { sessionId })
		toast(`Moved ${group.name} to ${nameOf(sessionId)}`, {
			action: {
				label: 'Undo',
				onClick: () => updateStashed(library, stashId, { sessionId: group.sessionId }),
			},
		})
	}

	async function deleteStashed(stashId: string): Promise<void> {
		const library = await start()
		const group = getStashed(library, stashId)
		if (!group) return
		const tabs = await getStashedTabs(library, stashId)
		await removeStashed(library, stashId)
		toast(`Deleted ${group.name} and its ${pluralize(tabs.length, 'tab')}`, {
			action: {
				label: 'Undo',
				onClick: () =>
					void addStashed(library, group.sessionId, group, tabs, group.createdAt),
			},
		})
	}

	async function switchTo(id: string): Promise<void> {
		const library = await start()
		try {
			const result = await actions.switchTo(library, id)
			if (!result) return
			toast(`Switched to ${nameOf(id)}`, {
				description: `${nameOf(result.fromId)} was saved as you left it.`,
				action: { label: 'Undo', onClick: () => void switchTo(result.fromId) },
			})
			if (result.failed.length) {
				toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
			}
		} catch (error) {
			toast.error(`Couldn't switch: ${errorText(error)}`)
		}
	}

	async function saveVersion(): Promise<void> {
		const library = await start()
		await actions.saveVersion(library)
		toast(`Saved a version of ${nameOf(getOpenSessionId(library))}`)
	}

	async function saveOpenAs(name: string): Promise<string> {
		const library = await start()
		const id = await actions.saveOpenAs(library, name)
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
		const id = await actions.saveCopy(library, name, tabIds)
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
			const result = await actions.putAway(library)
			if (!result) return
			toast(`Put ${nameOf(leaving)} away`, {
				action: { label: 'Undo', onClick: () => void switchTo(leaving) },
			})
		} catch (error) {
			toast.error(`Couldn't put it away: ${errorText(error)}`)
		}
	}

	async function openCopy(id: string, versionId?: string): Promise<void> {
		const library = await start()
		const result = await actions.openCopy(library, id, versionId)
		if (result?.failed.length)
			toast.warning(`Chrome wouldn't reopen ${pluralize(result.failed.length, 'tab')}`)
	}

	async function moveTabs(
		tabIds: number[],
		target: { sessionId: string } | { name: string },
	): Promise<void> {
		const library = await start()
		try {
			const id = await actions.moveTabs(library, tabIds, target)
			toast(`Moved ${pluralize(tabIds.length, 'tab')} to ${nameOf(id)}`, {
				action: { label: 'Open a copy', onClick: () => void openCopy(id) },
			})
		} catch (error) {
			toast.error(`Couldn't move them: ${errorText(error)}`)
		}
	}

	async function rename(id: string, name: string): Promise<void> {
		updateSession(await start(), id, { name })
	}

	async function setNotes(id: string, description: string): Promise<void> {
		updateSession(await start(), id, { description })
	}

	async function archive(id: string): Promise<void> {
		const library = await start()
		await setStatus(library, id, 'archived')
		toast(`Archived ${nameOf(id)}`, {
			action: { label: 'Undo', onClick: () => void setStatus(library, id, 'closed') },
		})
	}

	async function unarchive(id: string): Promise<void> {
		await setStatus(await start(), id, 'closed')
	}

	async function remove(id: string): Promise<void> {
		const library = await start()
		const name = nameOf(id)
		await deleteSession(library, id)
		toast(`Deleted ${name}`)
	}

	async function restoreOlder(id: string, versionId: string): Promise<void> {
		const library = await start()
		await restoreVersion(library, id, versionId)
		toast(`Restored an older version of ${nameOf(id)}`, {
			description: 'The version it replaced is still in the list.',
		})
	}

	/** Save edits to a closed session's tabs as a new version */
	async function saveEdits(id: string, data: VersionData): Promise<void> {
		const library = await start()
		await addVersion(library, id, data, 'edit')
		toast(`Saved your changes to ${nameOf(id)}`, {
			description: 'The previous version is still in the list.',
		})
	}

	async function applyMove(result: MigrationResult): Promise<void> {
		const { moveIn } = await import('@/lib/library/moveIn')
		await moveIn(await start(), result)
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
		homeId: HOME_ID,
		lastUsed,
		library: () => start(),
		getData: async (id: string) => getSessionData(await start(), id),
		getVersionData: async (versionId: string) => getVersionData(await start(), versionId),
		listVersions: (id: string) => (lib.value ? listVersions(lib.value, id) : []),
		switchTo,
		saveVersion,
		saveOpenAs,
		saveCopy,
		putAway,
		openCopy,
		moveTabs,
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
