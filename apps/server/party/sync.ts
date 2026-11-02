/**
 * Sync Party Server
 *
 * Handles authenticated WebSocket connections for TinyBase synchronization.
 * Each user gets their own room (room ID = user ID) for data isolation.
 *
 * Auth flow:
 * 1. Client connects with ?token=<session_token> query param
 * 2. Server verifies token against the Auth Party via cross-party fetch
 * 3. If valid and room ID matches user ID, connection is accepted
 * 4. If invalid, connection is closed with 4001
 *
 * Data storage:
 * - Clients push their TinyBase store content via WebSocket messages (type: "store:push")
 * - Data is persisted in PartyKit room storage
 * - HTTP GET /store-data returns the stored data for authenticated users
 */

import type * as Party from 'partykit/server'

// ==================== Types ====================

interface AuthenticatedUser {
	id: string
	email: string
}

interface AuthVerifyResponse {
	valid: boolean
	user?: AuthenticatedUser
}

interface ConnectionAuth {
	userId: string
	email: string
}

interface StorePushMessage {
	type: 'store:push'
	tables: Record<string, Record<string, Record<string, unknown>>>
}

interface ClusterInputTab {
	stableId: string
	title: string
	url: string
}

interface ClusterResult {
	name: string
	tabIds: string[]
}

/** Cloudflare Workers AI binding (present only when configured in the Cloudflare dashboard). */
interface WorkersAi {
	run: (model: string, input: unknown) => Promise<{ response?: string; data?: number[][] }>
}

interface SearchHit {
	stableId: string
	score: number
}

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0
	let magA = 0
	let magB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		magA += a[i] * a[i]
		magB += b[i] * b[i]
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB)
	return denom === 0 ? 0 : dot / denom
}

// ==================== Constants ====================

const STORE_DATA_KEY = 'store:tables'
const STORE_UPDATED_KEY = 'store:updatedAt'

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

// ==================== Sync Server ====================

export default class SyncServer implements Party.Server {
	constructor(readonly room: Party.Room) {}

	async onConnect(connection: Party.Connection<ConnectionAuth>, ctx: Party.ConnectionContext) {
		// Extract token from query params
		const url = new URL(ctx.request.url)
		const token = url.searchParams.get('token')

		if (!token) {
			connection.send(
				JSON.stringify({
					type: 'error',
					message: 'Authentication required',
				}),
			)
			connection.close(4001, 'Authentication required')
			return
		}

		// Verify token with the Auth Party
		const user = await this.verifyToken(token)
		if (!user) {
			connection.send(
				JSON.stringify({
					type: 'error',
					message: 'Invalid or expired token',
				}),
			)
			connection.close(4001, 'Invalid or expired token')
			return
		}

		// Enforce data isolation: room ID must match the authenticated user's ID
		if (this.room.id !== user.id) {
			connection.send(
				JSON.stringify({
					type: 'error',
					message: 'Access denied',
				}),
			)
			connection.close(4003, 'Access denied')
			return
		}

		// Mark connection as authenticated
		connection.setState({ userId: user.id, email: user.email })

		connection.send(
			JSON.stringify({
				type: 'sync:connected',
				userId: user.id,
			}),
		)
	}

	async onMessage(
		message: string | ArrayBuffer | ArrayBufferView,
		sender: Party.Connection<ConnectionAuth>,
	) {
		// Reject messages from unauthenticated connections
		if (!sender.state?.userId) {
			sender.close(4001, 'Not authenticated')
			return
		}

		if (typeof message !== 'string') return

		try {
			const data = JSON.parse(message) as StorePushMessage

			if (data.type === 'store:push' && data.tables) {
				// Persist the tables to room storage
				await this.room.storage.put(STORE_DATA_KEY, data.tables)
				await this.room.storage.put(STORE_UPDATED_KEY, Date.now())

				// Broadcast to other connections (other devices) so they can pull
				for (const conn of this.room.getConnections<ConnectionAuth>()) {
					if (conn.id !== sender.id && conn.state?.userId) {
						conn.send(
							JSON.stringify({
								type: 'store:updated',
								updatedAt: Date.now(),
							}),
						)
					}
				}
			}
		} catch {
			// Ignore unparseable messages
		}
	}

	onClose(connection: Party.Connection<ConnectionAuth>) {
		const state = connection.state
		if (state?.userId) {
			console.log(`Sync connection closed for user ${state.userId}`)
		}
	}

	/**
	 * HTTP request handler.
	 *
	 * GET /store-data   - returns stored TinyBase data (requires auth token)
	 * POST /store-data  - pushes TinyBase data (requires auth token)
	 * GET /admin-status - returns connection info (requires DASHBOARD_SECRET)
	 */
	async onRequest(request: Party.Request): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS })
		}

		const url = new URL(request.url)
		const path = url.pathname.split('/').pop()

		// ==================== Store Data Endpoints ====================

		if (path === 'store-data') {
			// Authenticate via Bearer token
			const user = await this.authenticateRequest(request)
			if (!user) {
				return Response.json(
					{ error: 'Unauthorized' },
					{ status: 401, headers: CORS_HEADERS },
				)
			}

			// Enforce room = user
			if (this.room.id !== user.id) {
				return Response.json(
					{ error: 'Access denied' },
					{ status: 403, headers: CORS_HEADERS },
				)
			}

			if (request.method === 'GET') {
				const tables = await this.room.storage.get(STORE_DATA_KEY)
				const updatedAt = await this.room.storage.get(STORE_UPDATED_KEY)

				return Response.json(
					{
						tables: tables || null,
						updatedAt: updatedAt || null,
					},
					{ headers: CORS_HEADERS },
				)
			}

			if (request.method === 'POST') {
				try {
					const body = (await request.json()) as { tables: Record<string, unknown> }
					if (!body.tables) {
						return Response.json(
							{ error: 'Missing tables' },
							{ status: 400, headers: CORS_HEADERS },
						)
					}
					await this.room.storage.put(STORE_DATA_KEY, body.tables)
					await this.room.storage.put(STORE_UPDATED_KEY, Date.now())

					return Response.json({ ok: true }, { headers: CORS_HEADERS })
				} catch {
					return Response.json(
						{ error: 'Invalid JSON' },
						{ status: 400, headers: CORS_HEADERS },
					)
				}
			}
		}

		// ==================== LLM Clustering Endpoint ====================

		if (path === 'cluster' && request.method === 'POST') {
			const user = await this.authenticateRequest(request)
			if (!user) {
				return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
			}
			if (this.room.id !== user.id) {
				return Response.json({ error: 'Access denied' }, { status: 403, headers: CORS_HEADERS })
			}

			let tabs: ClusterInputTab[] = []
			try {
				const body = (await request.json()) as { tabs?: ClusterInputTab[] }
				tabs = body.tabs ?? []
			} catch {
				return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS })
			}

			const clusters = await this.clusterTabs(tabs)
			return Response.json({ clusters }, { headers: CORS_HEADERS })
		}

		// ==================== Semantic Search Endpoint ====================

		if (path === 'search' && request.method === 'POST') {
			const user = await this.authenticateRequest(request)
			if (!user) {
				return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
			}
			if (this.room.id !== user.id) {
				return Response.json({ error: 'Access denied' }, { status: 403, headers: CORS_HEADERS })
			}

			let query = ''
			let tabs: ClusterInputTab[] = []
			try {
				const body = (await request.json()) as { query?: string; tabs?: ClusterInputTab[] }
				query = body.query ?? ''
				tabs = body.tabs ?? []
			} catch {
				return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS })
			}

			const results = await this.semanticRank(query, tabs)
			return Response.json({ results }, { headers: CORS_HEADERS })
		}

		// ==================== Admin Endpoint ====================

		if (request.method === 'GET' && path === 'admin-status') {
			if (!this.isAdminAuthorized(request)) {
				return Response.json(
					{ error: 'Unauthorized' },
					{ status: 401, headers: CORS_HEADERS },
				)
			}

			const connections: Array<{
				id: string
				userId: string | undefined
				email: string | undefined
			}> = []

			for (const conn of this.room.getConnections<ConnectionAuth>()) {
				connections.push({
					id: conn.id,
					userId: conn.state?.userId,
					email: conn.state?.email,
				})
			}

			return Response.json(
				{
					roomId: this.room.id,
					connectionCount: connections.length,
					connections,
				},
				{ headers: CORS_HEADERS },
			)
		}

		return Response.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS })
	}

	// ==================== LLM Clustering ====================

	/**
	 * Group tabs into named contexts. Uses Cloudflare Workers AI when the `AI`
	 * binding is configured; otherwise falls back to deterministic domain grouping
	 * so the feature still works (just less smart).
	 */
	private async clusterTabs(tabs: ClusterInputTab[]): Promise<ClusterResult[]> {
		if (tabs.length === 0) return []

		const ai = (this.room.env as Record<string, unknown>).AI as WorkersAi | undefined
		if (ai) {
			try {
				const result = await this.clusterWithAI(ai, tabs)
				if (result.length) return result
			} catch (err) {
				console.error('AI clustering failed, falling back to domain grouping:', err)
			}
		}
		return this.clusterByDomain(tabs)
	}

	private async clusterWithAI(ai: WorkersAi, tabs: ClusterInputTab[]): Promise<ClusterResult[]> {
		const list = tabs.map((t) => `- ${t.stableId} :: ${t.title} :: ${t.url}`).join('\n')
		const system =
			'You group browser tabs into project/topic contexts. Reply with STRICT JSON only, no prose.'
		const user =
			'Group these tabs into 2-6 contexts by topic/project. Each tab id must appear in exactly ' +
			'one group. Respond as JSON: {"clusters":[{"name":"Short Name","tabIds":["id1","id2"]}]}.\n\n' +
			`Tabs:\n${list}`

		const res = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			max_tokens: 1024,
		})

		const parsed = JSON.parse(this.extractJson(res.response ?? '')) as {
			clusters?: ClusterResult[]
		}
		const valid = new Set(tabs.map((t) => t.stableId))
		return (parsed.clusters ?? [])
			.map((c) => ({
				name: String(c.name || 'Untitled').slice(0, 40),
				tabIds: (c.tabIds ?? []).filter((id) => valid.has(id)),
			}))
			.filter((c) => c.tabIds.length > 0)
	}

	/** Pull the first JSON object out of a possibly-chatty model response. */
	private extractJson(text: string): string {
		const start = text.indexOf('{')
		const end = text.lastIndexOf('}')
		return start >= 0 && end > start ? text.slice(start, end + 1) : '{}'
	}

	/**
	 * Rank tabs against a query. Uses Workers AI embeddings (cosine similarity)
	 * on the fly when the `AI` binding exists; otherwise substring matching.
	 * (Persisting embeddings in Vectorize is the scale-up path — see plans/.)
	 */
	private async semanticRank(query: string, tabs: ClusterInputTab[]): Promise<SearchHit[]> {
		if (!query.trim() || tabs.length === 0) return []

		const ai = (this.room.env as Record<string, unknown>).AI as WorkersAi | undefined
		if (ai) {
			try {
				const texts = [query, ...tabs.map((t) => `${t.title} ${t.url}`)]
				const res = await ai.run('@cf/baai/bge-base-en-v1.5', { text: texts })
				const vecs = res.data
				if (Array.isArray(vecs) && vecs.length === texts.length) {
					const q = vecs[0]
					return tabs
						.map((t, i) => ({ stableId: t.stableId, score: cosineSimilarity(q, vecs[i + 1]) }))
						.sort((a, b) => b.score - a.score)
						.slice(0, 12)
				}
			} catch (err) {
				console.error('Semantic search failed, falling back to substring:', err)
			}
		}

		const ql = query.toLowerCase()
		return tabs
			.map((t) => ({
				stableId: t.stableId,
				score: `${t.title} ${t.url}`.toLowerCase().includes(ql) ? 1 : 0,
			}))
			.filter((r) => r.score > 0)
			.slice(0, 12)
	}

	private clusterByDomain(tabs: ClusterInputTab[]): ClusterResult[] {
		const groups = new Map<string, string[]>()
		for (const t of tabs) {
			let host = 'other'
			try {
				host = new URL(t.url).hostname.replace(/^www\./, '')
			} catch {
				/* keep 'other' */
			}
			const arr = groups.get(host) ?? []
			arr.push(t.stableId)
			groups.set(host, arr)
		}
		return [...groups.entries()].map(([name, tabIds]) => ({ name, tabIds }))
	}

	// ==================== Auth Helpers ====================

	/**
	 * Authenticate an HTTP request via Bearer token header.
	 * Returns the authenticated user or null.
	 */
	private async authenticateRequest(request: Party.Request): Promise<AuthenticatedUser | null> {
		const authHeader = request.headers.get('Authorization')
		if (!authHeader?.startsWith('Bearer ')) return null
		const token = authHeader.slice(7)
		return this.verifyToken(token)
	}

	private isAdminAuthorized(request: Party.Request): boolean {
		const secret = this.room.env.DASHBOARD_SECRET as string | undefined
		if (!secret) return false

		const authHeader = request.headers.get('Authorization')
		if (authHeader === `Bearer ${secret}`) return true

		const url = new URL(request.url)
		if (url.searchParams.get('secret') === secret) return true

		return false
	}

	/**
	 * Verify a session token by calling the Auth Party's /verify endpoint.
	 * Uses cross-party communication (PartyKit party stubs).
	 */
	private async verifyToken(token: string): Promise<AuthenticatedUser | null> {
		try {
			const authParty = this.room.context.parties.auth.get('main')
			const response = await authParty.fetch('/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
			})

			const data = (await response.json()) as AuthVerifyResponse

			if (data.valid && data.user) {
				return data.user
			}
			return null
		} catch (err) {
			console.error('Token verification failed:', err)
			return null
		}
	}
}
