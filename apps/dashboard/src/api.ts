/**
 * Dashboard API client
 *
 * Handles all communication with the PartyKit Auth Party.
 * In production, uses relative paths (same origin as PartyKit).
 * In development, uses VITE_PARTYKIT_HOST env var.
 */

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || ''

const PROTOCOL = PARTYKIT_HOST.includes('localhost') ? 'http' : 'https'
const BASE = PARTYKIT_HOST ? `${PROTOCOL}://${PARTYKIT_HOST}` : ''

const AUTH_BASE = `${BASE}/parties/auth/main`

// ==================== Types ====================

export interface AuthUser {
	id: string
	email: string
	role: 'user' | 'admin'
}

export interface SessionInfo {
	id: string
	deviceName: string
	deviceId: string
	createdAt: number
	lastActiveAt: number
	isCurrent: boolean
}

export interface AdminStats {
	totalUsers: number
	totalActiveSessions: number
	activeUsersLast24h: number
	timestamp: number
}

export interface AdminUser {
	id: string
	email: string
	role: 'user' | 'admin'
	createdAt: number
	sessionCount: number
	lastActiveAt: number | null
}

export interface ActivityEvent {
	type: 'register' | 'login' | 'login_failed' | 'logout' | 'logout_all' | 'verify'
	email: string
	timestamp: number
	success: boolean
	deviceName?: string
}

export interface UserDetail {
	user: {
		id: string
		email: string
		role: 'user' | 'admin'
		createdAt: number
	} | null
	sessions: Array<{
		id: string
		deviceName: string
		deviceId: string
		createdAt: number
		lastActiveAt: number
	}>
}

// ==================== Auth API ====================

export async function login(
	email: string,
	password: string,
): Promise<{ token: string; user: AuthUser }> {
	const res = await fetch(`${AUTH_BASE}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email,
			password,
			deviceName: 'Dashboard',
			deviceId: 'dashboard-web',
		}),
	})
	const data = await res.json()
	if (!res.ok) throw new Error(data.error || 'Login failed')
	return data
}

export async function verify(token: string): Promise<{ valid: boolean; user?: AuthUser }> {
	const res = await fetch(`${AUTH_BASE}/verify`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	})
	return res.json()
}

export async function logout(token: string): Promise<void> {
	await fetch(`${AUTH_BASE}/logout`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	}).catch(() => {})
}

// ==================== User API ====================

export async function listSessions(token: string): Promise<SessionInfo[]> {
	const res = await fetch(`${AUTH_BASE}/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	})
	const data = await res.json()
	return data.sessions || []
}

export async function revokeSession(token: string, sessionToRevoke: string): Promise<void> {
	await fetch(`${AUTH_BASE}/revoke`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token, sessionToRevoke }),
	})
}

// ==================== Admin API ====================

function adminHeaders(token: string) {
	return { Authorization: `Bearer ${token}` }
}

export async function getAdminStats(token: string): Promise<AdminStats> {
	const res = await fetch(`${AUTH_BASE}/admin-stats`, { headers: adminHeaders(token) })
	return res.json()
}

export async function getAdminUsers(token: string): Promise<AdminUser[]> {
	const res = await fetch(`${AUTH_BASE}/admin-users`, { headers: adminHeaders(token) })
	const data = await res.json()
	return data.users || []
}

export async function getAdminActivity(token: string): Promise<ActivityEvent[]> {
	const res = await fetch(`${AUTH_BASE}/admin-activity`, { headers: adminHeaders(token) })
	const data = await res.json()
	return data.events || []
}

export async function getAdminUserSessions(token: string, userId: string): Promise<UserDetail> {
	const res = await fetch(`${AUTH_BASE}/admin-user-sessions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ userId }),
	})
	return res.json()
}

// ==================== Sync Data API ====================

export interface SyncedTab {
	sessionId: string
	stableId: string
	url: string
	title: string
	favIconUrl: string
	windowId: number
	groupId: number
	active: boolean
	index: number
}

export interface SyncedGroup {
	sessionId: string
	originalId: number
	title: string
	color: string
	collapsed: boolean
	windowId: number
}

export interface SyncedWindow {
	sessionId: string
	originalId: number
	width: number
	height: number
	left: number
	top: number
}

export interface SyncedSession {
	id: string
	title: string
	description: string
	createdAt: number
	updatedAt: number
	tabs: SyncedTab[]
	groups: SyncedGroup[]
	windows: SyncedWindow[]
}

export interface SyncStoreData {
	tables: {
		sessions?: Record<string, Record<string, unknown>>
		tabs?: Record<string, Record<string, unknown>>
		groups?: Record<string, Record<string, unknown>>
		windows?: Record<string, Record<string, unknown>>
	} | null
	updatedAt: number | null
}

/**
 * Fetch the user's synced TinyBase data from the sync party.
 * The sync room ID = user ID, so we need the user's ID.
 */
export async function getSyncedData(token: string, userId: string): Promise<SyncStoreData> {
	const syncBase = `${BASE}/party/${userId}`
	const res = await fetch(`${syncBase}/store-data`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (!res.ok) throw new Error('Failed to fetch synced data')
	return res.json()
}

/**
 * Assemble raw TinyBase tables into structured sessions.
 */
export function assembleSessions(data: SyncStoreData): SyncedSession[] {
	if (!data.tables) return []

	const { sessions = {}, tabs = {}, groups = {}, windows = {} } = data.tables

	return Object.entries(sessions)
		.map(([id, session]) => {
			const row = session as Record<string, unknown>

			const sessionTabs = Object.values(tabs)
				.filter((t) => (t as Record<string, unknown>).sessionId === id)
				.map((t) => t as unknown as SyncedTab)
				.sort((a, b) => a.index - b.index)

			const sessionGroups = Object.values(groups)
				.filter((g) => (g as Record<string, unknown>).sessionId === id)
				.map((g) => g as unknown as SyncedGroup)

			const sessionWindows = Object.values(windows)
				.filter((w) => (w as Record<string, unknown>).sessionId === id)
				.map((w) => w as unknown as SyncedWindow)

			return {
				id,
				title: (row.title as string) || '',
				description: (row.description as string) || '',
				createdAt: (row.createdAt as number) || 0,
				updatedAt: (row.updatedAt as number) || 0,
				tabs: sessionTabs,
				groups: sessionGroups,
				windows: sessionWindows,
			}
		})
		.sort((a, b) => b.updatedAt - a.updatedAt)
}
