import type * as Party from 'partykit/server'

// ==================== Types ====================

type UserRole = 'user' | 'admin'

interface User {
	id: string
	email: string
	passwordHash: string
	role: UserRole
	createdAt: number
}

interface Session {
	id: string
	userId: string
	userEmail: string
	userRole: UserRole
	deviceName: string
	deviceId: string
	createdAt: number
	lastActiveAt: number
}

interface ActivityEvent {
	type: 'register' | 'login' | 'login_failed' | 'logout' | 'logout_all' | 'verify'
	email: string
	timestamp: number
	success: boolean
	deviceName?: string
}

type RequestBody = {
	email?: string
	password?: string
	deviceName?: string
	deviceId?: string
	token?: string
	sessionToRevoke?: string
}

const MAX_ACTIVITY_EVENTS = 100
const ACTIVITY_STORAGE_KEY = 'auth:recent-activity'

// ==================== CORS Headers ====================

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ==================== Auth Server ====================

/**
 * Auth Party Server
 *
 * Handles user authentication with email/password.
 * Uses database-backed session tokens (not JWTs) for:
 * - Immediate revocation capability
 * - Session tracking across devices
 * - Last activity tracking
 *
 * Room ID: "main" (single global room for auth)
 *
 * Endpoints:
 * - POST /register - Create new user account
 * - POST /login - Login existing user
 * - POST /verify - Verify session token
 * - POST /logout - Logout current session
 * - POST /logout-all - Logout all sessions for user
 * - POST /sessions - List all active sessions
 * - POST /revoke - Revoke a specific session
 */
export default class AuthServer implements Party.Server {
	constructor(readonly room: Party.Room) {}

	async onRequest(request: Party.Request): Promise<Response> {
		const url = new URL(request.url)

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS })
		}

		// Route to handlers based on pathname
		const path = url.pathname.split('/').pop()

		// Admin routes (GET) - protected by DASHBOARD_SECRET env var
		if (request.method === 'GET' && path?.startsWith('admin-')) {
			return this.handleAdminRoute(request, path)
		}

		// Auth routes require POST
		if (request.method !== 'POST') {
			return this.jsonResponse({ error: 'Method not allowed' }, 405)
		}

		// Parse request body
		let body: RequestBody = {}
		try {
			body = (await request.json()) as RequestBody
		} catch {
			return this.jsonResponse({ error: 'Invalid JSON body' }, 400)
		}

		// Admin POST routes
		if (path?.startsWith('admin-')) {
			return this.handleAdminPostRoute(request, path, body)
		}

		switch (path) {
			case 'register':
				return this.handleRegister(body)
			case 'login':
				return this.handleLogin(body)
			case 'verify':
				return this.handleVerify(body)
			case 'logout':
				return this.handleLogout(body)
			case 'logout-all':
				return this.handleLogoutAll(body)
			case 'sessions':
				return this.handleListSessions(body)
			case 'revoke':
				return this.handleRevokeSession(body)
			default:
				return this.jsonResponse({ error: 'Not found' }, 404)
		}
	}

	// ==================== Route Handlers ====================

	/**
	 * Register a new user
	 * POST /register
	 * Body: { email, password, deviceName?, deviceId? }
	 */
	private async handleRegister(body: RequestBody): Promise<Response> {
		const { email, password, deviceName, deviceId } = body

		if (!email || !password) {
			return this.jsonResponse({ error: 'Email and password are required' }, 400)
		}

		if (password.length < 8) {
			return this.jsonResponse({ error: 'Password must be at least 8 characters' }, 400)
		}

		// Normalize email
		const normalizedEmail = email.toLowerCase().trim()

		// Check email format
		if (!this.isValidEmail(normalizedEmail)) {
			return this.jsonResponse({ error: 'Invalid email format' }, 400)
		}

		// Check if user already exists
		const existingUser = await this.room.storage.get<User>(`user:${normalizedEmail}`)
		if (existingUser) {
			return this.jsonResponse({ error: 'User already exists' }, 409)
		}

		// Hash password
		const passwordHash = await this.hashPassword(password)

		// Create user (all new users start as 'user', promote via /admin-promote)
		const user: User = {
			id: crypto.randomUUID(),
			email: normalizedEmail,
			passwordHash,
			role: 'user',
			createdAt: Date.now(),
		}

		await this.room.storage.put(`user:${normalizedEmail}`, user)

		// Create session
		const session = await this.createSession(
			user,
			deviceName || 'Unknown Device',
			deviceId || crypto.randomUUID(),
		)

		await this.logActivity({
			type: 'register',
			email: normalizedEmail,
			timestamp: Date.now(),
			success: true,
			deviceName: deviceName,
		})

		return this.jsonResponse({
			token: session.id,
			user: { id: user.id, email: user.email, role: user.role },
		})
	}

	/**
	 * Login existing user
	 * POST /login
	 * Body: { email, password, deviceName?, deviceId? }
	 */
	private async handleLogin(body: RequestBody): Promise<Response> {
		const { email, password, deviceName, deviceId } = body

		if (!email || !password) {
			return this.jsonResponse({ error: 'Email and password are required' }, 400)
		}

		const normalizedEmail = email.toLowerCase().trim()
		const user = await this.room.storage.get<User>(`user:${normalizedEmail}`)

		if (!user) {
			await this.logActivity({
				type: 'login_failed',
				email: normalizedEmail,
				timestamp: Date.now(),
				success: false,
			})
			return this.jsonResponse({ error: 'Invalid credentials' }, 401)
		}

		const valid = await this.verifyPassword(password, user.passwordHash)
		if (!valid) {
			await this.logActivity({
				type: 'login_failed',
				email: normalizedEmail,
				timestamp: Date.now(),
				success: false,
			})
			return this.jsonResponse({ error: 'Invalid credentials' }, 401)
		}

		// Create new session
		const session = await this.createSession(
			user,
			deviceName || 'Unknown Device',
			deviceId || crypto.randomUUID(),
		)

		await this.logActivity({
			type: 'login',
			email: normalizedEmail,
			timestamp: Date.now(),
			success: true,
			deviceName: deviceName,
		})

		return this.jsonResponse({
			token: session.id,
			user: { id: user.id, email: user.email, role: user.role || 'user' },
		})
	}

	/**
	 * Verify session token (also updates lastActiveAt)
	 * POST /verify
	 * Body: { token }
	 */
	private async handleVerify(body: RequestBody): Promise<Response> {
		const { token } = body

		if (!token) {
			return this.jsonResponse({ valid: false, error: 'Token required' }, 400)
		}

		const session = await this.getSession(token)
		if (!session) {
			return this.jsonResponse({ valid: false }, 401)
		}

		// Update last active time
		session.lastActiveAt = Date.now()
		await this.room.storage.put(`session:${token}`, session)

		return this.jsonResponse({
			valid: true,
			user: {
				id: session.userId,
				email: session.userEmail,
				role: session.userRole || 'user',
			},
		})
	}

	/**
	 * Logout current session
	 * POST /logout
	 * Body: { token }
	 */
	private async handleLogout(body: RequestBody): Promise<Response> {
		const { token } = body

		if (!token) {
			return this.jsonResponse({ success: true })
		}

		const session = await this.getSession(token)
		if (session) {
			await this.room.storage.delete(`session:${token}`)
			await this.removeSessionFromUser(session.userId, token)

			await this.logActivity({
				type: 'logout',
				email: session.userEmail,
				timestamp: Date.now(),
				success: true,
			})
		}

		return this.jsonResponse({ success: true })
	}

	/**
	 * Logout all sessions for user
	 * POST /logout-all
	 * Body: { token }
	 */
	private async handleLogoutAll(body: RequestBody): Promise<Response> {
		const { token } = body

		if (!token) {
			return this.jsonResponse({ success: true })
		}

		const session = await this.getSession(token)
		if (session) {
			await this.deleteAllUserSessions(session.userId)

			await this.logActivity({
				type: 'logout_all',
				email: session.userEmail,
				timestamp: Date.now(),
				success: true,
			})
		}

		return this.jsonResponse({ success: true })
	}

	/**
	 * List all active sessions for user
	 * POST /sessions
	 * Body: { token }
	 */
	private async handleListSessions(body: RequestBody): Promise<Response> {
		const { token } = body

		if (!token) {
			return this.jsonResponse({ error: 'Token required' }, 400)
		}

		const session = await this.getSession(token)
		if (!session) {
			return this.jsonResponse({ error: 'Unauthorized' }, 401)
		}

		const sessions = await this.getUserSessions(session.userId)

		return this.jsonResponse({
			sessions: sessions.map((s) => ({
				id: s.id,
				deviceName: s.deviceName,
				deviceId: s.deviceId,
				createdAt: s.createdAt,
				lastActiveAt: s.lastActiveAt,
				isCurrent: s.id === token,
			})),
		})
	}

	/**
	 * Revoke a specific session
	 * POST /revoke
	 * Body: { token, sessionToRevoke }
	 */
	private async handleRevokeSession(body: RequestBody): Promise<Response> {
		const { token, sessionToRevoke } = body

		if (!token || !sessionToRevoke) {
			return this.jsonResponse({ error: 'Token and sessionToRevoke required' }, 400)
		}

		const session = await this.getSession(token)
		if (!session) {
			return this.jsonResponse({ error: 'Unauthorized' }, 401)
		}

		// Verify the session to revoke belongs to the same user
		const targetSession = await this.getSession(sessionToRevoke)
		if (targetSession && targetSession.userId === session.userId) {
			await this.room.storage.delete(`session:${sessionToRevoke}`)
			await this.removeSessionFromUser(session.userId, sessionToRevoke)
		}

		return this.jsonResponse({ success: true })
	}

	// ==================== Helper Methods ====================

	/**
	 * Create JSON response with CORS headers
	 */
	private jsonResponse(data: Record<string, unknown>, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
		})
	}

	/**
	 * Validate email format
	 */
	private isValidEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
		return emailRegex.test(email)
	}

	/**
	 * Hash password using SHA-256 with salt
	 */
	private async hashPassword(password: string): Promise<string> {
		const salt = crypto.randomUUID()
		const encoder = new TextEncoder()
		const data = encoder.encode(salt + password)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
		return `${salt}:${hashHex}`
	}

	/**
	 * Verify password against stored hash
	 */
	private async verifyPassword(password: string, hash: string): Promise<boolean> {
		const [salt, storedHash] = hash.split(':')
		if (!salt || !storedHash) return false

		const encoder = new TextEncoder()
		const data = encoder.encode(salt + password)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
		return hashHex === storedHash
	}

	/**
	 * Generate secure random token (32 bytes = 256 bits)
	 */
	private generateToken(): string {
		const bytes = new Uint8Array(32)
		crypto.getRandomValues(bytes)
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	}

	/**
	 * Create a new session for user
	 */
	private async createSession(
		user: User,
		deviceName: string,
		deviceId: string,
	): Promise<Session> {
		const token = this.generateToken()
		const now = Date.now()

		const session: Session = {
			id: token,
			userId: user.id,
			userEmail: user.email,
			userRole: user.role || 'user',
			deviceName,
			deviceId,
			createdAt: now,
			lastActiveAt: now,
		}

		// Store the session
		await this.room.storage.put(`session:${token}`, session)

		// Add to user's session list
		const userSessions =
			(await this.room.storage.get<string[]>(`user-sessions:${user.id}`)) || []
		userSessions.push(token)
		await this.room.storage.put(`user-sessions:${user.id}`, userSessions)

		return session
	}

	/**
	 * Get session by token
	 */
	private async getSession(token: string): Promise<Session | null> {
		if (!token) return null
		return (await this.room.storage.get<Session>(`session:${token}`)) || null
	}

	/**
	 * Get all sessions for a user
	 */
	private async getUserSessions(userId: string): Promise<Session[]> {
		const sessionIds = (await this.room.storage.get<string[]>(`user-sessions:${userId}`)) || []
		const sessions: Session[] = []

		for (const id of sessionIds) {
			const session = await this.room.storage.get<Session>(`session:${id}`)
			if (session) {
				sessions.push(session)
			}
		}

		return sessions
	}

	/**
	 * Remove a session from user's session list
	 */
	private async removeSessionFromUser(userId: string, sessionId: string): Promise<void> {
		const userSessions =
			(await this.room.storage.get<string[]>(`user-sessions:${userId}`)) || []
		const filtered = userSessions.filter((id) => id !== sessionId)
		await this.room.storage.put(`user-sessions:${userId}`, filtered)
	}

	/**
	 * Delete all sessions for a user
	 */
	private async deleteAllUserSessions(userId: string): Promise<void> {
		const sessionIds = (await this.room.storage.get<string[]>(`user-sessions:${userId}`)) || []

		for (const id of sessionIds) {
			await this.room.storage.delete(`session:${id}`)
		}

		await this.room.storage.put(`user-sessions:${userId}`, [])
	}

	// ==================== Activity Logging ====================

	/**
	 * Log an auth activity event (capped at MAX_ACTIVITY_EVENTS)
	 */
	private async logActivity(event: ActivityEvent): Promise<void> {
		try {
			const events =
				(await this.room.storage.get<ActivityEvent[]>(ACTIVITY_STORAGE_KEY)) || []
			events.push(event)

			// Keep only the most recent events
			if (events.length > MAX_ACTIVITY_EVENTS) {
				events.splice(0, events.length - MAX_ACTIVITY_EVENTS)
			}

			await this.room.storage.put(ACTIVITY_STORAGE_KEY, events)
		} catch {
			// Don't let logging failures break auth flows
		}
	}

	// ==================== Admin Routes ====================

	/**
	 * Resolve the authenticated user from a request.
	 * Checks Authorization: Bearer <token> header.
	 * Returns the User if valid, null otherwise.
	 */
	private async getRequestUser(request: Party.Request): Promise<User | null> {
		const authHeader = request.headers.get('Authorization')
		if (!authHeader?.startsWith('Bearer ')) return null

		const token = authHeader.slice(7)
		const session = await this.getSession(token)
		if (!session) return null

		// Look up the full user to get current role
		const user = await this.findUserById(session.userId)
		return user
	}

	/**
	 * Find a user by ID (scans user storage)
	 */
	private async findUserById(userId: string): Promise<User | null> {
		const usersMap = await this.room.storage.list<User>({ prefix: 'user:' })
		for (const [, user] of usersMap) {
			if (user.id === userId) return user
		}
		return null
	}

	/**
	 * Check if request has DASHBOARD_SECRET (for bootstrap operations)
	 */
	private hasDashboardSecret(request: Party.Request): boolean {
		const secret = this.room.env.DASHBOARD_SECRET as string | undefined
		if (!secret) return false

		const url = new URL(request.url)
		if (url.searchParams.get('secret') === secret) return true

		// Also check a X-Dashboard-Secret header (separate from Bearer token)
		if (request.headers.get('X-Dashboard-Secret') === secret) return true

		return false
	}

	/**
	 * Route admin GET requests.
	 * Requires either an admin user token OR DASHBOARD_SECRET.
	 */
	private async handleAdminRoute(request: Party.Request, path: string): Promise<Response> {
		const user = await this.getRequestUser(request)
		const isAdmin = user?.role === 'admin'
		const hasSecret = this.hasDashboardSecret(request)

		if (!isAdmin && !hasSecret) {
			return this.jsonResponse({ error: 'Unauthorized' }, 401)
		}

		switch (path) {
			case 'admin-stats':
				return this.handleAdminStats()
			case 'admin-users':
				return this.handleAdminUsers()
			case 'admin-activity':
				return this.handleAdminActivity()
			default:
				return this.jsonResponse({ error: 'Not found' }, 404)
		}
	}

	/**
	 * Handle POST admin routes (promote, user-sessions).
	 * Called from the main onRequest router.
	 */
	private async handleAdminPostRoute(
		request: Party.Request,
		path: string,
		body: RequestBody,
	): Promise<Response> {
		switch (path) {
			case 'admin-promote':
				return this.handleAdminPromote(request, body)
			case 'admin-user-sessions':
				return this.handleAdminUserSessions(request, body)
			default:
				return this.jsonResponse({ error: 'Not found' }, 404)
		}
	}

	/**
	 * POST /admin-promote
	 * Promote a user to admin role.
	 * Requires DASHBOARD_SECRET (bootstrap) or an existing admin's token.
	 * Body: { email }
	 */
	private async handleAdminPromote(request: Party.Request, body: RequestBody): Promise<Response> {
		const requestUser = await this.getRequestUser(request)
		const isAdmin = requestUser?.role === 'admin'
		const hasSecret = this.hasDashboardSecret(request)

		if (!isAdmin && !hasSecret) {
			return this.jsonResponse({ error: 'Unauthorized' }, 401)
		}

		const { email } = body
		if (!email) {
			return this.jsonResponse({ error: 'Email is required' }, 400)
		}

		const normalizedEmail = email.toLowerCase().trim()
		const user = await this.room.storage.get<User>(`user:${normalizedEmail}`)
		if (!user) {
			return this.jsonResponse({ error: 'User not found' }, 404)
		}

		// Update role
		user.role = 'admin'
		await this.room.storage.put(`user:${normalizedEmail}`, user)

		return this.jsonResponse({
			success: true,
			user: { id: user.id, email: user.email, role: user.role },
		})
	}

	/**
	 * POST /admin-user-sessions
	 * Get all sessions/devices for a specific user (admin only).
	 * Body: { token, userId }
	 */
	private async handleAdminUserSessions(
		request: Party.Request,
		body: RequestBody,
	): Promise<Response> {
		const requestUser = await this.getRequestUser(request)
		if (requestUser?.role !== 'admin') {
			return this.jsonResponse({ error: 'Unauthorized' }, 401)
		}

		const userId = (body as Record<string, unknown>).userId as string | undefined
		if (!userId) {
			return this.jsonResponse({ error: 'userId is required' }, 400)
		}

		const sessions = await this.getUserSessions(userId)
		const targetUser = await this.findUserById(userId)

		return this.jsonResponse({
			user: targetUser
				? {
						id: targetUser.id,
						email: targetUser.email,
						role: targetUser.role || 'user',
						createdAt: targetUser.createdAt,
					}
				: null,
			sessions: sessions.map((s) => ({
				id: s.id,
				deviceName: s.deviceName,
				deviceId: s.deviceId,
				createdAt: s.createdAt,
				lastActiveAt: s.lastActiveAt,
			})),
		})
	}

	/**
	 * GET /admin-stats
	 * Returns aggregate stats: total users, total sessions, etc.
	 */
	private async handleAdminStats(): Promise<Response> {
		const users = await this.room.storage.list<User>({ prefix: 'user:' })
		const sessions = await this.room.storage.list<Session>({ prefix: 'session:' })

		let totalActiveSessions = 0
		const activeUsers = new Set<string>()
		const now = Date.now()
		const oneDayAgo = now - 24 * 60 * 60 * 1000

		for (const [, session] of sessions) {
			totalActiveSessions++
			if (session.lastActiveAt > oneDayAgo) {
				activeUsers.add(session.userId)
			}
		}

		return this.jsonResponse({
			totalUsers: users.size,
			totalActiveSessions,
			activeUsersLast24h: activeUsers.size,
			timestamp: now,
		})
	}

	/**
	 * GET /admin-users
	 * Returns list of all users with their session counts and roles
	 */
	private async handleAdminUsers(): Promise<Response> {
		const usersMap = await this.room.storage.list<User>({ prefix: 'user:' })
		const users: Array<{
			id: string
			email: string
			role: UserRole
			createdAt: number
			sessionCount: number
			lastActiveAt: number | null
		}> = []

		for (const [, user] of usersMap) {
			const userSessions = await this.getUserSessions(user.id)
			let lastActive: number | null = null

			for (const s of userSessions) {
				if (lastActive === null || s.lastActiveAt > lastActive) {
					lastActive = s.lastActiveAt
				}
			}

			users.push({
				id: user.id,
				email: user.email,
				role: user.role || 'user',
				createdAt: user.createdAt,
				sessionCount: userSessions.length,
				lastActiveAt: lastActive,
			})
		}

		users.sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))

		return this.jsonResponse({ users })
	}

	/**
	 * GET /admin-activity
	 * Returns recent auth activity events
	 */
	private async handleAdminActivity(): Promise<Response> {
		const events = (await this.room.storage.get<ActivityEvent[]>(ACTIVITY_STORAGE_KEY)) || []

		return this.jsonResponse({
			events: [...events].reverse(),
		})
	}
}
