/**
 * opencode — use the model your opencode server uses for Smart group.
 *
 * Pairing: `opencode pair` prints a one-time link (valid 5 minutes). Opening it with a
 * JSON request returns a session token, used as the password in Basic auth (username
 * `opencode`) for 30 days. The token is kept in chrome.storage on this device only, and
 * never goes into backups.
 */
import type { Ask } from '@/lib/smartGroup'

export interface OpencodeConnection {
	/** Server address, e.g. http://127.0.0.1:4096 */
	url: string
	token: string
	/** Use it for Smart group */
	enabled: boolean
	version: string
	/** The model's display name, so you know where tab titles go */
	model: string
}

export const OPENCODE_KEY = 'papaya:opencode'

type Fetch = typeof fetch

/** The server address and one-time code in an `opencode pair` link */
export function parsePairLink(link: string): { url: string; code: string } {
	let parsed: URL
	try {
		parsed = new URL(link.trim())
	} catch {
		throw new Error('Paste the whole link that `opencode pair` printed')
	}
	const match = parsed.pathname.match(/^(.*)\/auth\/connect\/([^/]+)\/?$/)
	if (!match || !/^https?:$/.test(parsed.protocol)) {
		throw new Error('That isn’t an `opencode pair` link (…/auth/connect/…)')
	}
	return { url: `${parsed.origin}${match[1]}`, code: match[2] }
}

const authHeader = (token: string) => `Basic ${btoa(`opencode:${token}`)}`

async function request<T>(
	connection: Pick<OpencodeConnection, 'url' | 'token'>,
	path: string,
	init: RequestInit = {},
	fetchImpl: Fetch = fetch,
): Promise<T> {
	let response: Response
	try {
		response = await fetchImpl(`${connection.url}${path}`, {
			...init,
			headers: {
				Authorization: authHeader(connection.token),
				'Content-Type': 'application/json',
				...init.headers,
			},
		})
	} catch (error) {
		if ((error as Error)?.name === 'AbortError') throw error
		throw new Error(`Can't reach opencode at ${connection.url}. Is it running?`)
	}
	if (response.status === 401) {
		throw new Error('opencode no longer accepts this pairing. Pair again in Settings.')
	}
	if (!response.ok) throw new Error(`opencode answered ${response.status}`)
	return (await response.json()) as T
}

/** Version and default model of a paired server; fails if the pairing no longer works */
export async function checkConnection(
	connection: Pick<OpencodeConnection, 'url' | 'token'>,
	fetchImpl: Fetch = fetch,
): Promise<{ version: string; model: string }> {
	const [info, model] = await Promise.all([
		request<{ version: string }>(connection, '/api/info', {}, fetchImpl),
		request<{ data?: { name?: string; id?: string } }>(
			connection,
			'/api/model/default',
			{},
			fetchImpl,
		),
	])
	return {
		version: info.version,
		model: model.data?.name || model.data?.id || 'its default model',
	}
}

/** Trade an `opencode pair` link for a token, check it works, and save the connection */
export async function pair(link: string, fetchImpl: Fetch = fetch): Promise<OpencodeConnection> {
	const { url, code } = parsePairLink(link)
	let response: Response
	try {
		response = await fetchImpl(`${url}/auth/connect/${encodeURIComponent(code)}`, {
			headers: { Accept: 'application/json' },
		})
	} catch {
		throw new Error(`Can't reach opencode at ${url}. Is it running?`)
	}
	if (!response.ok) {
		throw new Error('That link was already used or has expired. Run `opencode pair` again.')
	}
	const { token } = (await response.json()) as { token?: string }
	if (!token) throw new Error('opencode didn’t return a token')
	const details = await checkConnection({ url, token }, fetchImpl)
	const connection: OpencodeConnection = { url, token, enabled: true, ...details }
	await chrome.storage.local.set({ [OPENCODE_KEY]: connection })
	return connection
}

export async function loadConnection(): Promise<OpencodeConnection | null> {
	const stored = (await chrome.storage.local.get(OPENCODE_KEY))[OPENCODE_KEY]
	return stored && typeof stored === 'object' ? (stored as OpencodeConnection) : null
}

export async function updateConnection(changes: Partial<OpencodeConnection>): Promise<void> {
	const current = await loadConnection()
	if (current) await chrome.storage.local.set({ [OPENCODE_KEY]: { ...current, ...changes } })
}

/** Forget the token. (It stays valid on the server until it expires or the password changes.) */
export async function disconnect(): Promise<void> {
	await chrome.storage.local.remove(OPENCODE_KEY)
}

/** Ask opencode's model one prompt, through its text generation endpoint */
export function askOpencode(connection: OpencodeConnection, fetchImpl: Fetch = fetch): Ask {
	return async (prompt, signal) => {
		const reply = await request<{ data?: { text?: string } }>(
			connection,
			'/api/experimental/generate/text',
			{ method: 'POST', body: JSON.stringify({ prompt }), signal },
			fetchImpl,
		)
		return reply.data?.text ?? ''
	}
}
