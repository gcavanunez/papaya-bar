/**
 * The background worker's side of the library: the only context that writes it.
 *
 * Pages and the website palette ask for named commands. Every write, a command or any
 * other work put on the queue, runs alone and in order: the next starts only after the
 * one before has finished, however long it waits on Chrome, and the index is saved if it
 * changed.
 * Work on the queue must not wait for other queued work, or both wait forever.
 */
import * as actions from './actions'
import { importLibrary, type LibraryBackup } from './backup'
import { COMMAND_MESSAGE, OPEN_MESSAGE, type WorkerReply } from './client'
import type { MigrationResult } from './migrate'
import type { LibrarySession, SessionContent, SavedTab } from './model'
import { openLibrary, type WriterLibrary } from './runtime'
import * as stash from './stash'
import {
	addStashed,
	applyMigration,
	createSession,
	deleteSession,
	isMigrated,
	removeStashed,
	setContent,
	setStatus,
	updateSession,
	updateStashed,
	type Library,
	type StashedGroup,
} from './store'

/**
 * Everything a page or the palette may ask the worker to do. Arguments and results
 * cross a message, so both are plain JSON data.
 */
const commands = {
	switchTo: (lib: Library, a: { sessionId: string }) => actions.switchTo(lib, a.sessionId),
	/** A checkpoint of the open session, made by hand */
	saveCheckpoint: (lib: Library) => actions.saveCheckpoint(lib),
	saveOpenAs: (lib: Library, a: { name: string }) => actions.saveOpenAs(lib, a.name),
	saveCopy: (lib: Library, a: { name?: string; tabIds?: number[] }) =>
		actions.saveCopy(lib, a.name, a.tabIds),
	putAway: (lib: Library) => actions.putAway(lib),
	moveTabs: (
		lib: Library,
		a: { tabIds: number[]; target: { sessionId: string } | { name: string } },
	) => actions.moveTabs(lib, a.tabIds, a.target),
	createSession: (
		lib: Library,
		a: { fields: { name: string; description?: string }; data?: SessionContent },
	) => createSession(lib, a.fields, a.data),
	updateSession: async (
		lib: Library,
		a: { id: string; fields: Partial<Pick<LibrarySession, 'name' | 'description' | 'color'>> },
	) => updateSession(lib, a.id, a.fields),
	setStatus: (lib: Library, a: { id: string; status: 'closed' | 'archived' }) =>
		setStatus(lib, a.id, a.status),
	deleteSession: (lib: Library, a: { id: string }) => deleteSession(lib, a.id),
	/** For the open session this also reopens the checkpoint in the browser */
	restoreCheckpoint: (lib: Library, a: { sessionId: string; checkpointId: string }) =>
		actions.restoreCheckpoint(lib, a.sessionId, a.checkpointId),
	/** Edits to a closed session's tabs */
	saveEdits: (lib: Library, a: { sessionId: string; data: SessionContent }) =>
		setContent(lib, a.sessionId, a.data, 'careful', { reason: 'edit' }),
	/** Unlinked: open the open session's saved tabs next to what's open */
	reopenSaved: (lib: Library) => actions.reopenSaved(lib),
	/** Unlinked: what's open becomes the open session's content */
	keepOpen: (lib: Library) => actions.keepOpen(lib),
	stashGroup: (lib: Library, a: { groupId: number }) => stash.stashGroup(lib, a.groupId),
	stashGroups: (lib: Library, a: { groupIds: number[] }) => stash.stashGroups(lib, a.groupIds),
	/** `windowId`: where to reopen it, which only the asking page knows */
	openStashed: (lib: Library, a: { stashId: string; windowId?: number }) =>
		stash.openStashed(lib, a.stashId, a.windowId),
	swapToStashed: (lib: Library, a: { stashId: string; windowId?: number }) =>
		stash.swapToStashed(lib, a.stashId, a.windowId),
	swapToGroup: (lib: Library, a: { groupId: number }) => stash.swapToGroup(lib, a.groupId),
	/** Put a deleted stashed group back (Undo) */
	addStashed: (
		lib: Library,
		a: {
			sessionId: string
			group: Pick<StashedGroup, 'name' | 'color'>
			tabs: SavedTab[]
			createdAt?: number
		},
	) => addStashed(lib, a.sessionId, a.group, a.tabs, a.createdAt),
	updateStashed: async (
		lib: Library,
		a: { id: string; fields: Partial<Pick<StashedGroup, 'name' | 'color' | 'sessionId'>> },
	) => updateStashed(lib, a.id, a.fields),
	removeStashed: (lib: Library, a: { id: string }) => removeStashed(lib, a.id),
	/**
	 * The move-in from the old stores, planned by a page (only pages can read them). Only
	 * once: a late second plan must not reset what has been saved since.
	 */
	moveIn: async (lib: Library, a: { plan: MigrationResult }) => {
		if (!isMigrated(lib)) await applyMigration(lib, a.plan)
	},
	/** A backup's library part, or an old backup planned as a move-in, read by a page */
	importLibrary: (
		lib: Library,
		a: { source: LibraryBackup | MigrationResult; mode: 'replace' | 'merge' },
	) => importLibrary(lib, a.source, a.mode),
}

type Commands = typeof commands
/** The commands' names, arguments and results, so pages ask for them with types */
export type CommandName = keyof Commands
export type CommandArgs<N extends CommandName> = Parameters<Commands[N]>[1]
export type CommandResult<N extends CommandName> = Awaited<ReturnType<Commands[N]>>

type MessageListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (reply: WorkerReply) => void,
) => boolean | undefined

export interface LibraryWriter {
	/** The worker's library, opened and upgraded once; a failed open is retried next call */
	library(): Promise<Library>
	/** Run some writing work alone, after everything queued before it; the index, if changed, is saved before it resolves */
	enqueue<T>(work: (lib: Library) => Promise<T>): Promise<T>
	/** Run a command on the queue */
	run<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<CommandResult<N>>
	/** For chrome.runtime.onMessage: answers the library's messages from pages */
	onMessage: MessageListener
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The worker makes one; tests make one each, over a fresh fake Chrome */
export function createLibraryWriter(): LibraryWriter {
	let opening: Promise<WriterLibrary> | null = null
	const open = () => {
		opening ??= openLibrary().catch((error) => {
			opening = null
			throw error
		})
		return opening
	}

	let queue: Promise<unknown> = Promise.resolve()
	function enqueue<T>(work: (lib: Library) => Promise<T>): Promise<T> {
		const next = queue.then(async () => {
			const { lib, save } = await open()
			try {
				return await work(lib)
			} finally {
				await save()
			}
		})
		queue = next.catch(() => undefined)
		return next
	}

	function run<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<CommandResult<N>> {
		const command = commands[name] as (lib: Library, args: unknown) => Promise<CommandResult<N>>
		if (!Object.prototype.hasOwnProperty.call(commands, name)) {
			return Promise.reject(new Error(`Unknown library command: ${String(name)}`))
		}
		return enqueue((lib) => command(lib, args))
	}

	const onMessage: MessageListener = (message, _sender, sendResponse) => {
		const { type, name, args } = (message ?? {}) as {
			type?: string
			name?: string
			args?: unknown
		}
		let work: Promise<unknown>
		if (type === OPEN_MESSAGE) work = open()
		else if (type === COMMAND_MESSAGE) work = run(name as CommandName, args as never)
		else return undefined
		work.then(
			(result) =>
				sendResponse({ ok: true, result: type === OPEN_MESSAGE ? undefined : result }),
			(error) => {
				console.warn('[papaya] library', name ?? type, error)
				sendResponse({ ok: false, error: errorText(error) })
			},
		)
		return true // the answer comes later
	}

	return { library: async () => (await open()).lib, enqueue, run, onMessage }
}
