/**
 * opencodeTools — Papaya hosts its own tools for opencode sessions.
 *
 * opencode's client MCP (experimental): Papaya opens a WebSocket to opencode and serves
 * an MCP server named "papaya" over it. Its tools exist only for sessions in the folder
 * the socket names, and only while the socket is open. Papaya's folder is
 * ~/.config/papaya-bar; opencode won't attach tools to a folder that doesn't exist, and
 * neither Papaya nor opencode can create it, so it's made once by hand. opencode also
 * refuses the connection from an origin it hasn't been told to allow, and Chrome sends
 * chrome-extension://<id>, so that's allowed once too (allowOriginCommand).
 *
 * Smart group uses this: in a short session in that folder, the model proposes each
 * group as a call to papaya_propose_group. Papaya checks every call (a tab number that
 * doesn't exist goes back to the model as an error to fix) and sees each group the
 * moment it's proposed.
 */
import { authHeader, firstSentence, request, type OpencodeConnection } from '@/lib/opencode'
import {
	GROUPING_RULES,
	MIN_GROUP_SIZE,
	buildPrompt,
	cleanName,
	mergeSuggestions,
	type GroupableTab,
	type Suggestion,
} from '@/lib/smartGroup'

type Fetch = typeof fetch
type Connection = Pick<OpencodeConnection, 'url' | 'token'>

/** Where Papaya's opencode sessions run, under the home folder */
export const PAPAYA_FOLDER = '.config/papaya-bar'
/** The command that makes the folder */
export const MAKE_FOLDER = `mkdir -p ~/${PAPAYA_FOLDER}`
/** The MCP server's name; its tools reach the model as papaya_<tool> */
const SERVER_NAME = 'papaya'
/** How long a Smart group run may take before it's stopped */
const RUN_TIMEOUT_MS = 180_000
/** How long opencode may take to ask for the tools once the socket is open */
const READY_TIMEOUT_MS = 10_000

const at = (folder: string) => `location%5Bdirectory%5D=${encodeURIComponent(folder)}`

// ==================== The folder ====================

export type FolderStatus =
	| { state: 'ready'; folder: string }
	| { state: 'missing'; folder: string }
	/**
	 * opencode refuses tool connections from Papaya's origin (chrome-extension://…) until
	 * it's on opencode's allowed list: see allowOriginCommand
	 */
	| { state: 'blocked'; folder: string }
	/** This opencode doesn't offer client MCP */
	| { state: 'unsupported'; reason: string }

/**
 * Restart opencode's background service: through launchd when it runs it (macOS,
 * ai.opencode.service), otherwise with opencode's own command
 */
const RESTART_SERVICE = `{ launchctl kickstart -k "gui/$(id -u)/ai.opencode.service" 2>/dev/null || opencode service restart; }`

/**
 * The command that lets Papaya (this extension's origin) connect its tools to opencode.
 * `opencode service set cors` only takes http(s) origins, though the server accepts
 * any (`opencode serve --cors chrome-extension://…` works); the service's settings file
 * only needs a list of strings. So the command adds the origin there (keeping any
 * others) and restarts the service.
 */
export const allowOriginCommand = (origin: string) =>
	`python3 -c 'import json,os;p=os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"),"opencode","service.json");os.makedirs(os.path.dirname(p),exist_ok=True);d=json.load(open(p)) if os.path.exists(p) else {};c=d.setdefault("cors",[]);c.count("${origin}") or c.append("${origin}");json.dump(d,open(p,"w"),indent=2)' && ${RESTART_SERVICE}`

/**
 * The home folder a path is in. opencode's background service runs in the home folder
 * itself; a server started in a project folder still runs under it.
 */
export function homeOf(directory: string): string {
	const home = directory.match(/^(\/(?:Users|home)\/[^/]+|\/root)(?:\/|$)/)
	return home ? home[1] : directory.replace(/\/+$/, '')
}

/** The home folder, from the folder opencode runs in by default */
async function homeFolder(connection: Connection, fetchImpl: Fetch): Promise<string> {
	const reply = await request<{ directory?: string; data?: { directory?: string } }>(
		connection,
		'/api/location',
		{},
		fetchImpl,
	)
	const directory = reply?.directory ?? reply?.data?.directory
	if (!directory) throw new Error("opencode didn't say which folder it runs in")
	return homeOf(directory)
}

interface Ticket {
	status: number
	ticket?: string
	tag?: string
	message?: string
}

/**
 * A one-use ticket (valid a minute) to open the tools socket. The header is opencode's
 * guard against requests from other sites; the socket itself can't carry the token.
 */
async function ticketFor(
	connection: Connection,
	folder: string,
	fetchImpl: Fetch,
): Promise<Ticket> {
	let response: Response
	try {
		response = await fetchImpl(
			`${connection.url}/api/experimental/client-mcp/token?name=${SERVER_NAME}&${at(folder)}`,
			{
				method: 'POST',
				headers: { Authorization: authHeader(connection.token), 'x-opencode-ticket': '1' },
			},
		)
	} catch {
		throw new Error(`Can't reach opencode at ${connection.url}. Is it running?`)
	}
	if (response.status === 401) {
		throw new Error('opencode no longer accepts this pairing. Pair again in Settings.')
	}
	const body = (await response.json().catch(() => null)) as {
		_tag?: string
		message?: string
		data?: { ticket?: string }
	} | null
	return {
		status: response.status,
		ticket: body?.data?.ticket,
		tag: body?._tag,
		message: body?.message,
	}
}

/** Whether Papaya's folder exists, so Smart group can use tool calls */
export async function checkFolder(
	connection: Connection,
	fetchImpl: Fetch = fetch,
): Promise<FolderStatus> {
	const folder = `${await homeFolder(connection, fetchImpl)}/${PAPAYA_FOLDER}`
	const ticket = await ticketFor(connection, folder, fetchImpl)
	if (ticket.ticket) return { state: 'ready', folder }
	if (ticket.tag === 'LocationNotFoundError') return { state: 'missing', folder }
	// opencode only takes tool connections from origins on its allowed list
	if (ticket.status === 403) return { state: 'blocked', folder }
	return {
		state: 'unsupported',
		reason: ticket.message
			? firstSentence(ticket.message)
			: `opencode answered ${ticket.status}`,
	}
}

// ==================== Hosting tools ====================

export interface ToolResult {
	text: string
	/** The call was wrong; the model sees the text and can try again */
	isError?: boolean
}

export interface PapayaTool {
	name: string
	description: string
	inputSchema: Record<string, unknown>
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
	call(args: Record<string, unknown>): ToolResult | Promise<ToolResult>
}

export interface HostedTools {
	close(): void
}

/** What hostTools needs from a WebSocket */
export interface SocketLike {
	readonly readyState: number
	send(data: string): void
	close(): void
	onopen: ((event: Event) => void) | null
	onmessage: ((event: MessageEvent) => void) | null
	onerror: ((event: Event) => void) | null
	onclose: ((event: CloseEvent) => void) | null
}
export type OpenSocket = (url: string) => SocketLike

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Serve tools to opencode sessions in `folder` until close(). Resolves once opencode
 * has asked for the tool list, so a session started next can use them.
 */
export async function hostTools(
	connection: Connection,
	folder: string,
	tools: PapayaTool[],
	options: { fetchImpl?: Fetch; openSocket?: OpenSocket } = {},
): Promise<HostedTools> {
	const ticket = await ticketFor(connection, folder, options.fetchImpl ?? fetch)
	if (!ticket.ticket) {
		throw new Error(
			ticket.tag === 'LocationNotFoundError'
				? `The folder ~/${PAPAYA_FOLDER} is missing. Create it with: ${MAKE_FOLDER}`
				: ticket.status === 403
					? "opencode doesn't accept Papaya's tools yet: allow Papaya in Settings → Smart group"
					: `opencode wouldn't take Papaya's tools: ${ticket.message ?? ticket.status}`,
		)
	}
	const url =
		connection.url.replace(/^http/, 'ws') +
		`/api/experimental/client-mcp?name=${SERVER_NAME}&${at(folder)}&ticket=${encodeURIComponent(ticket.ticket)}`
	const socket = (options.openSocket ?? ((u: string) => new WebSocket(u) as SocketLike))(url)
	const send = (message: object) => {
		if (socket.readyState === 1) socket.send(JSON.stringify(message))
	}

	let markReady: () => void = () => {}
	let fail: (error: Error) => void = () => {}
	const ready = new Promise<void>((resolve, reject) => {
		markReady = resolve
		fail = reject
	})
	const timer = setTimeout(
		() => fail(new Error("opencode didn't ask for Papaya's tools")),
		READY_TIMEOUT_MS,
	)
	socket.onerror = () => fail(new Error("Couldn't open the tools connection to opencode"))
	socket.onclose = () => fail(new Error('opencode closed the tools connection'))

	socket.onmessage = async (event) => {
		let message: { id?: string | number; method?: string; params?: Record<string, unknown> }
		try {
			message = JSON.parse(String(event.data))
		} catch {
			return
		}
		// Only requests need an answer; notifications have no id
		if (message.id === undefined || !message.method) return
		const reply = (result: object) => send({ jsonrpc: '2.0', id: message.id, result })
		switch (message.method) {
			case 'initialize':
				reply({
					protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
					capabilities: { tools: {} },
					serverInfo: { name: SERVER_NAME, version: '1' },
				})
				return
			case 'tools/list':
				reply({ tools: tools.map(({ call: _call, ...tool }) => tool) })
				clearTimeout(timer)
				markReady()
				return
			case 'tools/call': {
				const name = String(message.params?.name ?? '')
				const tool = tools.find((t) => t.name === name)
				let result: ToolResult
				try {
					result = tool
						? await tool.call(
								(message.params?.arguments as Record<string, unknown>) ?? {},
							)
						: { text: `Papaya has no tool called ${name}`, isError: true }
				} catch (error) {
					result = { text: errorText(error), isError: true }
				}
				reply({
					content: [{ type: 'text', text: result.text }],
					...(result.isError ? { isError: true } : {}),
				})
				return
			}
			case 'ping':
				reply({})
				return
			default:
				send({
					jsonrpc: '2.0',
					id: message.id,
					error: { code: -32601, message: `Papaya doesn't handle ${message.method}` },
				})
		}
	}

	try {
		await ready
	} catch (error) {
		clearTimeout(timer)
		socket.close()
		throw error
	}
	// From here a closed socket just means the tools are gone
	socket.onclose = null
	socket.onerror = null
	return { close: () => socket.close() }
}

// ==================== Smart group with tool calls ====================

export const TOOLS_INSTRUCTIONS = `${GROUPING_RULES}
Propose each group by calling papaya_propose_group with its name and the numbers of its tabs. When every group is proposed, reply with just: done

`

/**
 * The tool the model proposes groups with. It keeps only real tab numbers that no
 * earlier group took, and tells the model what it did with each call.
 */
export function proposeGroupTool(
	batch: GroupableTab[],
	onGroup: (group: Suggestion) => void,
): PapayaTool {
	const taken = new Set<number>()
	return {
		name: 'propose_group',
		description:
			'Propose one tab group: a 1 to 3 word name and the numbers of the tabs in it. Call once per group.',
		inputSchema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Like a Chrome tab group label, e.g. "Taxes"',
				},
				tabs: {
					type: 'array',
					items: { type: 'integer', minimum: 1, maximum: batch.length },
					minItems: MIN_GROUP_SIZE,
					description: 'Tab numbers from the list',
				},
			},
			required: ['name', 'tabs'],
			additionalProperties: false,
		},
		call(args) {
			const name = cleanName(args.name)
			if (!name) return { text: 'The group needs a name of 1 to 3 words.', isError: true }
			const numbers: unknown[] = Array.isArray(args.tabs) ? args.tabs : []
			const unknown = numbers.filter(
				(n) => typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > batch.length,
			)
			if (unknown.length) {
				return {
					text: `There is no tab ${unknown.join(', ')}: the tabs are numbered 1 to ${batch.length}. Propose ${name} again with numbers from the list.`,
					isError: true,
				}
			}
			const unique = [...new Set(numbers as number[])]
			const free = unique.filter((n) => !taken.has(n))
			const already = unique.filter((n) => taken.has(n))
			const note = already.length
				? ` Tab ${already.join(', ')} is already in another group.`
				: ''
			if (free.length < MIN_GROUP_SIZE) {
				return {
					text: `${name} needs at least ${MIN_GROUP_SIZE} tabs that aren't in another group.${note}`,
					isError: true,
				}
			}
			for (const n of free) taken.add(n)
			onGroup({ name, tabIds: free.map((n) => batch[n - 1].id) })
			return { text: `Proposed ${name} with ${free.length} tabs.${note}` }
		},
	}
}

interface SessionMessage {
	type: string
	outcome?: string
	error?: { message?: string }
}

/**
 * Group tabs in a short opencode session in Papaya's folder, allowed only Papaya's
 * tools, with the model picked in Settings (or opencode's default). The session is
 * deleted afterwards, also when the run is stopped or fails.
 */
export async function groupWithTools(
	tabs: GroupableTab[],
	connection: OpencodeConnection,
	options: {
		signal?: AbortSignal
		onGroup?: (group: Suggestion, count: number) => void
		fetchImpl?: Fetch
		openSocket?: OpenSocket
		timeoutMs?: number
	} = {},
): Promise<Suggestion[]> {
	const folder = connection.folder
	if (!folder) throw new Error(`Papaya's folder isn't set up. Create it with: ${MAKE_FOLDER}`)
	const fetchImpl = options.fetchImpl ?? fetch
	const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS
	const signal = AbortSignal.any([
		...(options.signal ? [options.signal] : []),
		AbortSignal.timeout(timeoutMs),
	])
	const found: Suggestion[] = []
	const tool = proposeGroupTool(tabs, (group) => {
		found.push(group)
		options.onGroup?.(group, found.length)
	})
	const hosted = await hostTools(connection, folder, [tool], options)
	let sessionID: string | undefined
	try {
		const created = await request<{ id?: string; data?: { id?: string } }>(
			connection,
			'/api/session',
			{
				method: 'POST',
				body: JSON.stringify({
					title: 'Papaya: Smart group',
					location: { directory: folder },
					...(connection.choice
						? {
								model: {
									providerID: connection.choice.providerID,
									id: connection.choice.id,
								},
							}
						: {}),
					// Only Papaya's tools: no files, no shell, no web
					permissions: [
						{ action: '*', resource: '*', effect: 'deny' },
						{ action: `${SERVER_NAME}_*`, resource: '*', effect: 'allow' },
					],
				}),
				signal,
			},
			fetchImpl,
		)
		sessionID = created?.id ?? created?.data?.id
		if (!sessionID) throw new Error("opencode didn't start a session")
		await request(
			connection,
			`/api/session/${sessionID}/prompt`,
			{
				method: 'POST',
				body: JSON.stringify({ text: TOOLS_INSTRUCTIONS + buildPrompt(tabs, []) }),
				signal,
			},
			fetchImpl,
		)
		await request(
			connection,
			`/api/experimental/session/${sessionID}/wait`,
			{ method: 'POST', body: '{}', signal },
			fetchImpl,
		)
		const messages = await request<{ data?: SessionMessage[] }>(
			connection,
			`/api/session/${sessionID}/message?order=desc&limit=5`,
			{ signal },
			fetchImpl,
		)
		const end = messages?.data?.find((m) => m.type === 'idle')
		if (end?.outcome === 'failed') {
			throw new Error(firstSentence(end.error?.message ?? 'the model stopped with an error'))
		}
		return mergeSuggestions(found)
	} catch (error) {
		if (options.signal?.aborted) throw error
		if (signal.aborted) {
			throw new Error(`it took longer than ${Math.round(timeoutMs / 60_000) || 1} min`)
		}
		throw error
	} finally {
		hosted.close()
		// Deleting a session also stops it if it's still running
		if (sessionID) {
			void request(
				connection,
				`/api/session/${sessionID}`,
				{ method: 'DELETE' },
				fetchImpl,
			).catch(() => {})
		}
	}
}
