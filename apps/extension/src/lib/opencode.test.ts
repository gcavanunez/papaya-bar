import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import {
	askOpencode,
	disconnect,
	loadConnection,
	pair,
	parsePairLink,
	updateConnection,
	type OpencodeConnection,
} from './opencode'

const BASIC = `Basic ${btoa('opencode:tok-123')}`

/** A fake opencode server: one pairing code, a token, and a model that echoes */
function fakeServer() {
	const calls: { url: string; init?: RequestInit }[] = []
	let codeUsed = false
	let tokenValid = true
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
		if (path === '/api/model/default') return json(200, { data: { name: 'Claude Fable 5.2' } })
		if (path === '/api/experimental/generate/text') {
			const { prompt } = JSON.parse(String(init?.body))
			return json(200, { data: { text: `echo: ${prompt}` } })
		}
		return json(404, {})
	}) as unknown as typeof fetch
	return { fetchImpl, calls, expireToken: () => (tokenValid = false) }
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
