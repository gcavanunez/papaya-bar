import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import {
	askOpencode,
	disconnect,
	listModels,
	loadConnection,
	pair,
	parsePairLink,
	updateConnection,
	type OpencodeConnection,
} from './opencode'

const BASIC = `Basic ${btoa('opencode:tok-123')}`

const FABLE = {
	id: 'claude-fable-5-2',
	providerID: 'anthropic',
	name: 'Claude Fable 5.2',
	type: 'chat',
	enabled: true,
	status: 'active',
	limit: { context: 1_000_000, output: 128_000 },
	cost: [{ input: 8, output: 40, cache: { read: 0.2, write: 10 } }],
	capabilities: { output: ['text'] },
}
const MODELS = [
	FABLE,
	{
		id: 'claude-haiku-5-5',
		providerID: 'anthropic',
		name: 'Claude Haiku 5.5',
		type: 'chat',
		limit: { context: 1_000_000, output: 128_000 },
		// Long prompts cost more: the base price is the tier without a size
		cost: [
			{ input: 0.2, output: 1, tier: { type: 'context', size: 200_000 } },
			{ input: 0.1, output: 0.5 },
		],
		capabilities: { output: ['text'] },
	},
	// A model without a type is still a text model
	{
		id: 'tidepool-alpha-free',
		providerID: 'opencode',
		name: 'Tidepool Alpha Free',
		type: null,
		limit: { context: 1_048_576, output: 131_072 },
		cost: [{ input: 0, output: 0 }],
	},
	{ id: 'gpt-image-2', providerID: 'openai', name: 'GPT Image 2', type: 'image' },
	{ id: 'old', providerID: 'openai', name: 'Old', type: 'chat', status: 'deprecated' },
	{ id: 'off', providerID: 'openai', name: 'Off', type: 'chat', enabled: false },
]

/** A fake opencode server: one pairing code, a token, and a model that echoes */
function fakeServer() {
	const calls: { url: string; init?: RequestInit }[] = []
	let codeUsed = false
	let tokenValid = true
	let failure: { status: number; body: unknown } | null = null
	const json = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		})
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, init })
		const path = new URL(url).pathname
		const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
		if (path === '/auth/connect/good-code') {
			if (codeUsed) return json(401, { _tag: 'UnauthorizedError', message: 'used' })
			codeUsed = true
			return json(200, { token: 'tok-123' })
		}
		if (auth !== BASIC || !tokenValid)
			return json(401, { _tag: 'UnauthorizedError', message: 'no' })
		if (path === '/api/info') return json(200, { version: '2.3.0' })
		if (path === '/api/model/default') return json(200, { data: FABLE })
		if (path === '/api/model') return json(200, { data: MODELS })
		if (path === '/api/provider')
			return json(200, {
				data: [
					{ id: 'anthropic', name: 'Anthropic' },
					{ id: 'opencode', name: 'OpenCode' },
				],
			})
		if (path === '/api/experimental/generate/text') {
			if (failure) {
				return typeof failure.body === 'string'
					? new Response(failure.body, { status: failure.status })
					: json(failure.status, failure.body)
			}
			const { prompt } = JSON.parse(String(init?.body))
			return json(200, { data: { text: `echo: ${prompt}` } })
		}
		return json(404, {})
	}) as unknown as typeof fetch
	/** The body of the last generation request */
	const lastBody = () => JSON.parse(String(calls.at(-1)?.init?.body))
	return {
		fetchImpl,
		calls,
		lastBody,
		expireToken: () => (tokenValid = false),
		fail: (status: number, body: unknown) => (failure = { status, body }),
	}
}

beforeEach(() => {
	installFakeChrome()
})

describe('parsePairLink', () => {
	it('takes the server address and code from the printed link', () => {
		expect(parsePairLink(' http://127.0.0.1:4096/auth/connect/AbC-123 ')).toEqual({
			url: 'http://127.0.0.1:4096',
			code: 'AbC-123',
		})
		expect(parsePairLink('https://host.ts.net/oc/auth/connect/xyz')).toEqual({
			url: 'https://host.ts.net/oc',
			code: 'xyz',
		})
	})

	it('rejects anything else', () => {
		expect(() => parsePairLink('opencode pair')).toThrow(/whole link/)
		expect(() => parsePairLink('http://127.0.0.1:4096/api/info')).toThrow(/auth\/connect/)
		expect(() => parsePairLink('file:///auth/connect/x')).toThrow(/auth\/connect/)
	})
})

describe('pairing', () => {
	it('trades the link for a token, checks it, and saves the connection', async () => {
		const server = fakeServer()
		const connection = await pair(
			'http://127.0.0.1:4096/auth/connect/good-code',
			server.fetchImpl,
		)
		expect(connection).toEqual({
			url: 'http://127.0.0.1:4096',
			token: 'tok-123',
			enabled: true,
			version: '2.3.0',
			model: 'Claude Fable 5.2',
			limits: { context: 1_000_000, output: 128_000 },
		})
		expect(server.calls[0].init?.headers).toEqual({ Accept: 'application/json' })
		expect(await loadConnection()).toEqual(connection)
	})

	it('explains a used or expired link', async () => {
		const server = fakeServer()
		await pair('http://127.0.0.1:4096/auth/connect/good-code', server.fetchImpl)
		await expect(
			pair('http://127.0.0.1:4096/auth/connect/good-code', server.fetchImpl),
		).rejects.toThrow(/already used or has expired/)
	})

	it('can be turned off and forgotten', async () => {
		await pair('http://127.0.0.1:4096/auth/connect/good-code', fakeServer().fetchImpl)
		await updateConnection({ enabled: false })
		expect((await loadConnection())?.enabled).toBe(false)
		await disconnect()
		expect(await loadConnection()).toBeNull()
	})
})

describe('listModels', () => {
	const connection = { url: 'http://127.0.0.1:4096', token: 'tok-123' }

	it('lists the models that write text, with their provider, limits and price', async () => {
		const models = await listModels(connection, fakeServer().fetchImpl)
		expect(models).toEqual([
			{
				providerID: 'anthropic',
				id: 'claude-fable-5-2',
				name: 'Claude Fable 5.2',
				provider: 'Anthropic',
				limits: { context: 1_000_000, output: 128_000 },
				price: { input: 8, output: 40 },
			},
			{
				providerID: 'anthropic',
				id: 'claude-haiku-5-5',
				name: 'Claude Haiku 5.5',
				provider: 'Anthropic',
				limits: { context: 1_000_000, output: 128_000 },
				price: { input: 0.1, output: 0.5 },
			},
			{
				providerID: 'opencode',
				id: 'tidepool-alpha-free',
				name: 'Tidepool Alpha Free',
				provider: 'OpenCode',
				limits: { context: 1_048_576, output: 131_072 },
				price: { input: 0, output: 0 },
			},
		])
	})

	it('says to pair again when the token stops working', async () => {
		const server = fakeServer()
		server.expireToken()
		await expect(listModels(connection, server.fetchImpl)).rejects.toThrow(/Pair again/)
	})
})

describe('askOpencode', () => {
	const connection: OpencodeConnection = {
		url: 'http://127.0.0.1:4096',
		token: 'tok-123',
		enabled: true,
		version: '2.3.0',
		model: 'Claude Fable 5.2',
	}

	it('sends the prompt with the token and returns the text', async () => {
		const server = fakeServer()
		expect(await askOpencode(connection, server.fetchImpl)('hello')).toBe('echo: hello')
		const call = server.calls.at(-1)!
		expect(call.init?.method).toBe('POST')
		expect((call.init?.headers as Record<string, string>).Authorization).toBe(BASIC)
		// No model picked: opencode uses its default
		expect(server.lastBody()).toEqual({ prompt: 'hello' })
	})

	it('asks the model picked in Settings', async () => {
		const server = fakeServer()
		const picked = {
			...connection,
			choice: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
			model: 'Claude Haiku 5.5',
		}
		await askOpencode(picked, server.fetchImpl)('hello')
		expect(server.lastBody()).toEqual({
			prompt: 'hello',
			model: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
		})
	})

	it("says what went wrong in opencode's words, and when to try again", async () => {
		const server = fakeServer()
		server.fail(502, {
			_tag: 'ProviderRequestError',
			providerID: 'opencode',
			reason: 'rate_limit',
			message:
				'Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to keep going.',
			status: 429,
			retryAfterMs: 4_297_000,
		})
		await expect(askOpencode(connection, server.fetchImpl)('hello')).rejects.toThrow(
			'Free usage limit reached. Try again in 72 min.',
		)
		server.fail(500, 'Internal Server Error')
		await expect(askOpencode(connection, server.fetchImpl)('hello')).rejects.toThrow(
			'opencode answered 500',
		)
	})

	it('says to pair again when the token stops working', async () => {
		const server = fakeServer()
		server.expireToken()
		await expect(askOpencode(connection, server.fetchImpl)('hello')).rejects.toThrow(
			/Pair again/,
		)
	})

	it('says when opencode is not running', async () => {
		const down = (async () => {
			throw new TypeError('Failed to fetch')
		}) as unknown as typeof fetch
		await expect(askOpencode(connection, down)('hello')).rejects.toThrow(/Is it running/)
	})
})
