/**
 * The library for extension pages. Pages read their own copy and ask the background
 * worker, the only writer, to act. A command resolves only after this page's copy has
 * merged what the worker saved, so code after `await` sees the result.
 */
import { followLibrary, type PageLibrary } from './runtime'
import type { Library } from './store'
import type { CommandArgs, CommandName, CommandResult } from './writer'

/** Asks the worker to open the library (and upgrade it) if it has not yet */
export const OPEN_MESSAGE = 'library.open'
/** Asks the worker to run one named command */
export const COMMAND_MESSAGE = 'library.command'

/** What the worker answers; only JSON crosses, so a result is plain data */
export type WorkerReply = { ok: true; result?: unknown } | { ok: false; error: string }

async function ask(message: Record<string, unknown>): Promise<unknown> {
	const reply = (await chrome.runtime.sendMessage(message)) as WorkerReply | undefined
	if (!reply) throw new Error("Papaya's background worker did not answer")
	if (!reply.ok) throw new Error(reply.error)
	return reply.result
}

/** Commands without arguments are sent without any */
type ArgsOf<N extends CommandName> = CommandArgs<N> extends undefined ? [] : [CommandArgs<N>]

export interface LibraryClient {
	/** This page's copy, once the worker has opened the library; a failure is retried next call */
	getLibrary(): Promise<Library>
	/** Run a command in the worker; rejects with the worker's error message */
	send<N extends CommandName>(name: N, ...args: ArgsOf<N>): Promise<CommandResult<N>>
}

/** Pages use the one below; tests make one each, over a fresh fake Chrome */
export function createLibraryClient(): LibraryClient {
	let opening: Promise<PageLibrary> | null = null
	const open = () => {
		opening ??= ask({ type: OPEN_MESSAGE })
			.then(followLibrary)
			.catch((error) => {
				opening = null
				throw error
			})
		return opening
	}
	return {
		getLibrary: async () => (await open()).lib,
		async send(name, ...args) {
			const page = await open()
			try {
				return (await ask({ type: COMMAND_MESSAGE, name, args: args[0] })) as CommandResult<
					typeof name
				>
			} finally {
				// Even a failed command may have written some of its work
				await page.pull()
			}
		},
	}
}

const client = createLibraryClient()
export const getLibrary = client.getLibrary
export const sendCommand = client.send
