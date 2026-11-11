/**
 * useLibrary — the sessions library for Vue pages: reactive lists, plus the session
 * actions with their toasts and Undo. The actions themselves live in lib/library.
 */
import { computed, ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import { pluralize } from '@/lib/format'
import * as actions from '@/lib/library/actions'
import type { MigrationResult } from '@/lib/library/migrate'
import type { VersionData } from '@/lib/library/model'
import { getLibrary } from '@/lib/library/runtime'
import {
	HOME_ID,
	addVersion,
	deleteSession,
	getOpenSessionId,
	getSession,
	getSessionData,
	getVersionData,
	isMigrated,
	lastUsed,
	listSessions,
	listVersions,
	restoreVersion,
	setStatus,
	updateSession,
	type Library,
	type SessionSummary,
} from '@/lib/library/store'

// ==================== Shared (per-document) state ====================

const lib = shallowRef<Library | null>(null)
const sessions = ref<SessionSummary[]>([])
const openId = ref('')
const migrated = ref(false)
const ready = ref(false)
/** Bumps on every library change, for views that read versions */
const revision = ref(0)
let starting: Promise<Library> | null = null

function refresh(): void {
	if (!lib.value) return
	sessions.value = listSessions(lib.value)
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
		ready.value = true
		return library
	})
	return starting
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const nameOf = (id: string) => getSession(lib.value!, id)?.name ?? 'session'

// ==================== Composable ====================

export function useLibrary() {
	void start()

	const openSession = computed(() => sessions.value.find((s) => s.id === openId.value) ?? null)
	/** Sessions you can switch to: everything not open and not archived */
	const switchable = computed(() =>
		sessions.value.filter((s) => s.id !== openId.value && s.status !== 'archived'),
	)
	const archived = computed(() => sessions.value.filter((s) => s.status === 'archived'))

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

	async function park(tabs: chrome.tabs.Tab[]): Promise<number> {
		const library = await start()
		const count = await actions.parkTabs(library, tabs)
		if (count) {
			toast(`Parked ${pluralize(count, 'stale tab')}`, {
				action: { label: 'Open Parked', onClick: () => void openCopy(actions.PARKED_ID) },
			})
		}
		return count
	}

	async function rename(id: string, name: string): Promise<void> {
		updateSession(await start(), id, { name })
	}

	async function setNotes(id: string, description: string): Promise<void> {
		updateSession(await start(), id, { description })
	}

	async function archive(id: string): Promise<void> {
		const library = await start()
		setStatus(library, id, 'archived')
		toast(`Archived ${nameOf(id)}`, {
			action: { label: 'Undo', onClick: () => setStatus(library, id, 'closed') },
		})
	}

	async function unarchive(id: string): Promise<void> {
		setStatus(await start(), id, 'closed')
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
		park,
		rename,
		setNotes,
		archive,
		unarchive,
		remove,
		restoreOlder,
		saveEdits,
		applyMove,
	}
}
