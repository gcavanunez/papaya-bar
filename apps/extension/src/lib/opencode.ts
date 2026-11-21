/**
 * opencode — use a model from your opencode server for Smart group: the one picked in
 * Settings, or opencode's default model.
 *
 * Pairing: `opencode pair` prints a one-time link (valid 5 minutes). Opening it with a
 * JSON request returns a session token, used as the password in Basic auth (username
 * `opencode`) for 30 days. The token is kept in chrome.storage on this device only, and
 * never goes into backups.
 */
import type { Ask, ModelLimits } from '@/lib/smartGroup'

/** A model as opencode names it: provider and model id */
export interface ModelRef {
	providerID: string
	id: string
}

/** A model opencode can write text with, as its catalog describes it */
export interface OpencodeModel extends ModelRef {
	name: string
	/** The provider's display name, e.g. Anthropic */
	provider?: string
	limits: ModelLimits
	/** Dollars per million tokens read and written; absent when opencode doesn't say */
	price?: { input: number; output: number }
}

export interface OpencodeConnection {
	/** Server address, e.g. http://127.0.0.1:4096 */
	url: string
	token: string
	/** Use it for Smart group */
	enabled: boolean
	version: string
	/** The model's display name, so you know where tab titles go */
	model: string
	/** The model picked in Settings; without one, opencode's default model is used */
	choice?: ModelRef
	/** The model's limits, which size Smart group's batches */
	limits?: ModelLimits
	/**
	 * Papaya's folder for its opencode sessions (~/.config/papaya-bar), once it exists:
	 * then Smart group runs as tool calls instead of asking for JSON
	 */
	folder?: string
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

export const authHeader = (token: string) => `Basic ${btoa(`opencode:${token}`)}`

/** The first sentence says what happened; the rest is usually an advert or a link */
export const firstSentence = (message: string) =>
	message.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? message.trim()

/** One authenticated request to opencode; an empty reply (204) gives null */
export async function request<T>(
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
	if (!response.ok) throw new Error(await failureText(response))
	const text = await response.text()
	return (text ? JSON.parse(text) : null) as T
}

/** What went wrong, in opencode's words when it gives them, e.g. a free model's usage limit */
async function failureText(response: Response): Promise<string> {
	let body: { message?: unknown; retryAfterMs?: unknown } | null = null
	try {
		body = await response.json()
	} catch {
		// Not JSON: only the status is known
	}
	const message = typeof body?.message === 'string' ? body.message.trim() : ''
	if (!message) return `opencode answered ${response.status}`
	const first = firstSentence(message)
	const wait = typeof body?.retryAfterMs === 'number' ? body.retryAfterMs : 0
	return wait > 0 ? `${first} Try again in ${Math.ceil(wait / 60_000)} min.` : first
}

/** A model as opencode's API reports it */
interface RawModel {
	id: string
	providerID: string
	name?: string
	type?: string | null
	enabled?: boolean
	status?: string
	limit?: { context?: number; output?: number }
	cost?: { input: number; output: number; tier?: unknown }[]
	capabilities?: { output?: string[] }
}

function toModel(raw: RawModel): OpencodeModel {
	// Some models price long prompts higher: the base tier is the one without a tier
	const base = raw.cost?.find((c) => !c.tier) ?? raw.cost?.[0]
	return {
		providerID: raw.providerID,
		id: raw.id,
		name: raw.name || raw.id,
		limits: { context: raw.limit?.context, output: raw.limit?.output },
		...(base ? { price: { input: base.input, output: base.output } } : {}),
	}
}

const writesText = (raw: RawModel) =>
	raw.enabled !== false &&
	raw.status !== 'deprecated' &&
	raw.type !== 'image' &&
	raw.type !== 'decision' &&
	(raw.capabilities?.output ?? ['text']).includes('text')

export const sameModel = (a: ModelRef | undefined, b: ModelRef | undefined) =>
	!!a && !!b && a.providerID === b.providerID && a.id === b.id

/** The models opencode can write text with, in its catalog's order */
export async function listModels(
	connection: Pick<OpencodeConnection, 'url' | 'token'>,
	fetchImpl: Fetch = fetch,
): Promise<OpencodeModel[]> {
	const [models, providers] = await Promise.all([
		request<{ data?: RawModel[] }>(connection, '/api/model', {}, fetchImpl),
		// Only for display names: the ids stand in without them
		request<{ data?: { id: string; name?: string }[] }>(
			connection,
			'/api/provider',
			{},
			fetchImpl,
		).catch(() => ({ data: [] })),
	])
	const names = new Map((providers.data ?? []).map((p) => [p.id, p.name || p.id]))
	return (models.data ?? [])
		.filter(writesText)
		.map((raw) => ({ ...toModel(raw), provider: names.get(raw.providerID) ?? raw.providerID }))
}

/** Version and default model of a paired server; fails if the pairing no longer works */
export async function checkConnection(
	connection: Pick<OpencodeConnection, 'url' | 'token'>,
	fetchImpl: Fetch = fetch,
): Promise<{ version: string; defaultModel: OpencodeModel }> {
	const [info, model] = await Promise.all([
		request<{ version: string }>(connection, '/api/info', {}, fetchImpl),
		request<{ data?: RawModel }>(connection, '/api/model/default', {}, fetchImpl),
	])
	const defaultModel = model.data
		? toModel(model.data)
		: { providerID: '', id: '', name: 'its default model', limits: {} }
	return { version: info.version, defaultModel }
}

/** What a connection records about the model it uses */
export const modelDetails = (model: OpencodeModel) => ({
	model: model.name,
	limits: model.limits,
})

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
	const { version, defaultModel } = await checkConnection({ url, token }, fetchImpl)
	const connection: OpencodeConnection = {
		url,
		token,
		enabled: true,
		version,
		...modelDetails(defaultModel),
	}
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

/**
 * Ask one prompt through opencode's text generation endpoint: of the model picked in
 * Settings, or of opencode's default model
 */
export function askOpencode(connection: OpencodeConnection, fetchImpl: Fetch = fetch): Ask {
	const model = connection.choice
		? { providerID: connection.choice.providerID, id: connection.choice.id }
		: undefined
	return async (prompt, signal) => {
		const reply = await request<{ data?: { text?: string } }>(
			connection,
			'/api/experimental/generate/text',
			{
				method: 'POST',
				body: JSON.stringify(model ? { prompt, model } : { prompt }),
				signal,
			},
			fetchImpl,
		)
		return reply.data?.text ?? ''
	}
}
