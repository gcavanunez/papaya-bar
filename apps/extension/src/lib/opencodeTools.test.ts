import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import type { OpencodeConnection } from './opencode'
import {
	MAKE_FOLDER,
	TOOLS_INSTRUCTIONS,
	allowOriginCommand,
	checkFolder,
	groupWithTools,
	homeOf,
	hostTools,
	type OpenSocket,
	type SocketLike,
} from './opencodeTools'
import type { GroupableTab } from './smartGroup'

const HOME = '/Users/me'
const FOLDER = `${HOME}/.config/papaya-bar`

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type ToolReply = { content: { type: string; text: string }[]; isError?: boolean }

/**
 * A fake opencode: the client MCP handshake over a fake socket, sessions, and a "model"
 * that makes the given tool calls once prompted, then ends as told
 */
function fakeOpencode(
	options: {
		folderExists?: boolean
		/** opencode hasn't been told to allow Papaya's origin */
		originRefused?: boolean
		calls?: { name: string; arguments: Record<string, unknown> }[]
		end?: { outcome: 'succeeded' } | { outcome: 'failed'; message: string }
		/** The model never finishes: only stopping ends the run */
		hang?: boolean
	} = {},
) {
	const requests: {
		method: string
		path: string
		body?: unknown
		headers: Record<string, string>
	}[] = []
	const replies: ToolReply[] = []
	const deleted: string[] = []
	/** What each PATCH to the session set: the run's log, archived */
	const archived: Record<string, unknown>[] = []
	const stopped: string[] = []
	let socket: FakeSocket | null = null
	let modelDone: Promise<void> = Promise.resolve()

	class FakeSocket implements SocketLike {
		readyState = 0
		onopen: SocketLike['onopen'] = null
		onmessage: SocketLike['onmessage'] = null
		onerror: SocketLike['onerror'] = null
		onclose: SocketLike['onclose'] = null
		closed = false
		/** What Papaya answered, by request id */
		answers = new Map<number, (message: Record<string, unknown>) => void>()
		next = 1
		constructor(public url: string) {
			queueMicrotask(async () => {
				this.readyState = 1
				this.onopen?.(new Event('open'))
				await this.ask('initialize', { protocolVersion: '2025-11-25' })
				this.notify('notifications/initialized')
				await this.ask('tools/list', {})
			})
		}
		ask(method: string, params: object) {
			const id = this.next++
			return new Promise<Record<string, unknown>>((resolve) => {
				this.answers.set(id, resolve)
				this.onmessage?.(
					new MessageEvent('message', {
						data: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
					}),
				)
			})
		}
		notify(method: string) {
			this.onmessage?.(
				new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method }) }),
			)
		}
		send(data: string) {
			const message = JSON.parse(data)
			this.answers.get(message.id)?.(message)
		}
		close() {
			this.closed = true
			this.readyState = 3
		}
	}

	const openSocket: OpenSocket = (url) => (socket = new FakeSocket(url))

	const fetchImpl = (async (url: string, init: RequestInit = {}) => {
		const { pathname, searchParams } = new URL(url)
		const headers = (init.headers ?? {}) as Record<string, string>
		const body = init.body ? JSON.parse(String(init.body)) : undefined
		requests.push({ method: init.method ?? 'GET', path: pathname, body, headers })
		if (pathname === '/api/location') return json(200, { directory: HOME })
		if (pathname === '/api/experimental/client-mcp/token') {
			if (headers['x-opencode-ticket'] !== '1' || options.originRefused)
				return json(403, {
					_tag: 'ForbiddenError',
					message: 'Invalid client MCP connect token request',
				})
			const directory = searchParams.get('location[directory]')
			if (directory !== FOLDER || options.folderExists === false)
				return json(404, {
					_tag: 'LocationNotFoundError',
					message: `Location not found: ${directory}`,
				})
			return json(200, { location: { directory }, data: { ticket: 'tkt', expires_in: 60 } })
		}
		if (pathname === '/api/session' && init.method === 'POST')
			return json(200, { data: { id: 'ses_1' } })
		if (pathname === '/api/session/ses_1/prompt') {
			// The model calls the tools one at a time, like a model making tool calls
			modelDone = (async () => {
				if (options.hang) return new Promise<void>(() => {})
				for (const call of options.calls ?? []) {
					const answer = await socket!.ask('tools/call', call)
					replies.push(answer.result as ToolReply)
				}
			})()
			return json(200, { data: {} })
		}
		if (pathname === '/api/experimental/session/ses_1/wait') {
			await new Promise<void>((resolve, reject) => {
				init.signal?.addEventListener('abort', () =>
					reject(new DOMException('The operation was aborted.', 'AbortError')),
				)
				void modelDone.then(resolve)
			})
			return new Response(null, { status: 204 })
		}
		if (pathname === '/api/session/ses_1/message') {
			const end = options.end ?? { outcome: 'succeeded' }
			return json(200, {
				data: [
					end.outcome === 'failed'
						? { type: 'idle', outcome: 'failed', error: { message: end.message } }
						: { type: 'idle', outcome: 'succeeded' },
				],
			})
		}
		if (pathname === '/api/session/ses_1/interrupt') {
			stopped.push('ses_1')
			return json(200, { interrupted: true })
		}
		if (pathname === '/api/session/ses_1' && init.method === 'PATCH') {
			archived.push(body as Record<string, unknown>)
			return new Response(null, { status: 204 })
		}
		if (pathname === '/api/session/ses_1' && init.method === 'DELETE') {
			deleted.push('ses_1')
			return new Response(null, { status: 204 })
		}
		return json(404, {})
	}) as unknown as typeof fetch

	return {
		fetchImpl,
		openSocket,
		requests,
		replies,
		archived,
		stopped,
		deleted,
		socket: () => socket!,
	}
}

const connection: OpencodeConnection = {
	url: 'http://127.0.0.1:4096',
	token: 'tok',
	enabled: true,
	version: '2.3.2',
	model: 'Claude Haiku 5.5',
	choice: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
	folder: FOLDER,
}

const TABS: GroupableTab[] = [
	{ id: 101, title: 'Ownership - The Rust Book', url: 'https://doc.rust-lang.org/book/ch04' },
	{ id: 102, title: 'Traits - The Rust Book', url: 'https://doc.rust-lang.org/book/ch10' },
	{ id: 103, title: 'Form 1040 instructions', url: 'https://irs.gov/1040' },
	{ id: 104, title: 'Estimated taxes', url: 'https://irs.gov/estimated' },
	{ id: 105, title: 'Vue guide', url: 'https://vuejs.org/guide' },
]

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	installFakeChrome()
})

describe("Papaya's folder", () => {
	it('lives in the home folder, also when opencode was started in a project', () => {
		expect(homeOf('/Users/me')).toBe('/Users/me')
		expect(homeOf('/Users/me/code/app/')).toBe('/Users/me')
		expect(homeOf('/home/me/src')).toBe('/home/me')
		expect(homeOf('/root/work')).toBe('/root')
		expect(homeOf('/srv/opencode/')).toBe('/srv/opencode')
	})

	it('is ready when it exists under the home folder opencode runs in', async () => {
		const server = fakeOpencode()
		expect(await checkFolder(connection, server.fetchImpl)).toEqual({
			state: 'ready',
			folder: FOLDER,
		})
		// opencode's guard against requests from other sites
		const ticket = server.requests.find((r) => r.path.endsWith('/client-mcp/token'))!
		expect(ticket.headers['x-opencode-ticket']).toBe('1')
	})

	it('says when it still has to be made', async () => {
		const server = fakeOpencode({ folderExists: false })
		expect(await checkFolder(connection, server.fetchImpl)).toEqual({
			state: 'missing',
			folder: FOLDER,
		})
	})

	it("says when opencode hasn't been told to allow Papaya", async () => {
		const server = fakeOpencode({ originRefused: true })
		expect(await checkFolder(connection, server.fetchImpl)).toEqual({
			state: 'blocked',
			folder: FOLDER,
		})
		await expect(hostTools(connection, FOLDER, [], server)).rejects.toThrow(/allow Papaya/)
		// `opencode service set cors` refuses non-web origins, so the command edits the
		// service's settings file (keeping what's there) and restarts the service
		const command = allowOriginCommand('chrome-extension://abc')
		expect(command).toContain('"opencode","service.json"')
		expect(command).toContain(
			'c.count("chrome-extension://abc") or c.append("chrome-extension://abc")',
		)
		// Restarted through launchd where it runs opencode (macOS), else by opencode itself
		expect(command).toContain(
			'&& { launchctl kickstart -k "gui/$(id -u)/ai.opencode.service" 2>/dev/null || opencode service restart; }',
		)
	})
})

describe('hosting tools', () => {
	it("answers opencode's handshake and lists the tools without their code", async () => {
		const server = fakeOpencode()
		const hosted = await hostTools(
			connection,
			FOLDER,
			[
				{
					name: 'list_tabs',
					description: 'List tabs',
					inputSchema: { type: 'object' },
					annotations: { readOnlyHint: true },
					call: () => ({ text: '1. A tab' }),
				},
			],
			server,
		)
		const socket = server.socket()
		expect(socket.url).toBe(
			`ws://127.0.0.1:4096/api/experimental/client-mcp?name=papaya&location%5Bdirectory%5D=${encodeURIComponent(FOLDER)}&ticket=tkt`,
		)
		const list = await socket.ask('tools/list', {})
		expect(list.result).toEqual({
			tools: [
				{
					name: 'list_tabs',
					description: 'List tabs',
					inputSchema: { type: 'object' },
					annotations: { readOnlyHint: true },
				},
			],
		})
		expect(
			(await socket.ask('tools/call', { name: 'list_tabs', arguments: {} })).result,
		).toEqual({
			content: [{ type: 'text', text: '1. A tab' }],
		})
		expect((await socket.ask('ping', {})).result).toEqual({})
		expect((await socket.ask('resources/list', {})).error).toMatchObject({ code: -32601 })
		hosted.close()
		expect(socket.closed).toBe(true)
	})

	it('explains a missing folder', async () => {
		const server = fakeOpencode({ folderExists: false })
		await expect(hostTools(connection, FOLDER, [], server)).rejects.toThrow(MAKE_FOLDER)
	})
})

describe('Smart group with tool calls', () => {
	it('collects each proposed group as it lands, then archives the session as its log', async () => {
		const server = fakeOpencode({
			calls: [
				{ name: 'propose_group', arguments: { name: 'Rust', tabs: [1, 2] } },
				{ name: 'propose_group', arguments: { name: 'Taxes', tabs: [3, 4] } },
			],
		})
		const landed: [string, number][] = []
		const groups = await groupWithTools(TABS, connection, {
			...server,
			onGroup: (group, count) => landed.push([group.name, count]),
		})
		expect(groups).toEqual([
			{ name: 'Rust', tabIds: [101, 102] },
			{ name: 'Taxes', tabIds: [103, 104] },
		])
		expect(landed).toEqual([
			['Rust', 1],
			['Taxes', 2],
		])

		const created = server.requests.find((r) => r.path === '/api/session')!
		expect(created.body).toMatchObject({
			location: { directory: FOLDER },
			metadata: { papaya: { kind: 'smart-group', tabs: 5 } },
			model: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
			permissions: [
				{ action: '*', resource: '*', effect: 'deny' },
				{ action: 'papaya_*', resource: '*', effect: 'allow' },
			],
		})
		const prompt = server.requests.find((r) => r.path.endsWith('/prompt'))!.body as {
			text: string
		}
		expect(prompt.text.startsWith(TOOLS_INSTRUCTIONS)).toBe(true)
		expect(prompt.text).toContain('5. Vue guide (vuejs.org)')
		await flush()
		// Kept, not deleted: titled with what happened, and out of the way
		expect(server.archived).toEqual([
			{
				title: 'Papaya: Smart group · 2 groups from 5 tabs',
				metadata: {
					papaya: { kind: 'smart-group', tabs: 5, outcome: 'grouped', groups: 2 },
				},
				archived: true,
			},
		])
		expect(server.stopped).toEqual([])
		expect(server.deleted).toEqual([])
		expect(server.socket().closed).toBe(true)
	})

	it('sends a call with a tab that does not exist back to the model to fix', async () => {
		const server = fakeOpencode({
			calls: [
				{ name: 'propose_group', arguments: { name: 'Rust', tabs: [1, 99] } },
				{ name: 'propose_group', arguments: { name: 'Rust', tabs: [1, 2] } },
			],
		})
		const groups = await groupWithTools(TABS, connection, server)
		expect(server.replies[0]).toEqual({
			content: [
				{
					type: 'text',
					text: 'There is no tab 99: the tabs are numbered 1 to 5. Propose Rust again with numbers from the list.',
				},
			],
			isError: true,
		})
		expect(groups).toEqual([{ name: 'Rust', tabIds: [101, 102] }])
	})

	it('keeps a tab in the first group that took it, and says so', async () => {
		const server = fakeOpencode({
			calls: [
				{ name: 'propose_group', arguments: { name: 'Rust', tabs: [1, 2] } },
				{ name: 'propose_group', arguments: { name: 'Docs', tabs: [2, 3, 5] } },
			],
		})
		const groups = await groupWithTools(TABS, connection, server)
		expect(server.replies[1].content[0].text).toBe(
			'Proposed Docs with 2 tabs. Tab 2 is already in another group.',
		)
		expect(groups).toEqual([
			{ name: 'Rust', tabIds: [101, 102] },
			{ name: 'Docs', tabIds: [103, 105] },
		])
	})

	it("fails with the model's own reason, and keeps the session saying so", async () => {
		const server = fakeOpencode({
			end: {
				outcome: 'failed',
				message: 'Free usage limit reached. Connect a provider or subscribe to keep going.',
			},
		})
		await expect(groupWithTools(TABS, connection, server)).rejects.toThrow(
			/^Free usage limit reached\.$/,
		)
		await flush()
		expect(server.archived).toEqual([
			{
				title: 'Papaya: Smart group · failed: Free usage limit reached',
				metadata: {
					papaya: {
						kind: 'smart-group',
						tabs: 5,
						outcome: 'failed',
						reason: 'Free usage limit reached',
					},
				},
				archived: true,
			},
		])
		// It had already ended: nothing to interrupt
		expect(server.stopped).toEqual([])
	})

	it('stops when asked: interrupts the session, then archives it as stopped', async () => {
		const server = fakeOpencode({ hang: true })
		const stop = new AbortController()
		const run = groupWithTools(TABS, connection, { ...server, signal: stop.signal })
		await new Promise((resolve) => setTimeout(resolve, 5))
		stop.abort()
		await expect(run).rejects.toThrow()
		await flush()
		expect(server.stopped).toEqual(['ses_1'])
		expect(server.archived).toEqual([
			{
				title: 'Papaya: Smart group · stopped',
				metadata: { papaya: { kind: 'smart-group', tabs: 5, outcome: 'stopped' } },
				archived: true,
			},
		])
	})

	it('gives up after its time limit, saying so', async () => {
		const server = fakeOpencode({ hang: true })
		await expect(
			groupWithTools(TABS, connection, { ...server, timeoutMs: 20 }),
		).rejects.toThrow('it took longer than 1 min')
		await flush()
		expect(server.stopped).toEqual(['ses_1'])
		expect(server.archived[0]).toMatchObject({
			title: 'Papaya: Smart group · failed: it took longer than 1 min',
			archived: true,
		})
	})

	it('needs the folder first', async () => {
		await expect(
			groupWithTools(TABS, { ...connection, folder: undefined }, fakeOpencode()),
		).rejects.toThrow(MAKE_FOLDER)
	})
})
