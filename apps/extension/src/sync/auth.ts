/**
 * Client-side Auth Module
 *
 * Handles authentication with the PartyKit Auth Party.
 * Uses chrome.storage.local to persist auth state.
 *
 * Features:
 * - Email/password registration and login
 * - Session token management (database-backed, not JWTs)
 * - Device ID and device name detection
 * - Session listing and revocation
 * - Logout from current device or all devices
 */

// ==================== Configuration ====================

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

const AUTH_URL = PARTYKIT_HOST.includes('localhost')
	? `http://${PARTYKIT_HOST}/parties/auth/main`
	: `https://${PARTYKIT_HOST}/parties/auth/main`

// Storage keys
const AUTH_STORAGE_KEY = 'papaya:auth'
const DEVICE_ID_KEY = 'papaya:deviceId'

// ==================== Types ====================

export type UserRole = 'user' | 'admin'

export interface AuthUser {
	id: string
	email: string
	role: UserRole
}

export interface AuthState {
	token: string
	user: AuthUser
	deviceId: string
}

export interface SessionInfo {
	id: string
	deviceName: string
	deviceId: string
	createdAt: number
	lastActiveAt: number
	isCurrent: boolean
}

// ==================== Device Detection ====================

/**
 * Get or create a stable device ID
 * Uses localStorage since it needs to persist across extension restarts
 */
function getDeviceId(): string {
	let deviceId = localStorage.getItem(DEVICE_ID_KEY)
	if (!deviceId) {
		deviceId = crypto.randomUUID()
		localStorage.setItem(DEVICE_ID_KEY, deviceId)
	}
	return deviceId
}

/**
 * Get a human-readable device name based on user agent
 */
function getDeviceName(): string {
	const ua = navigator.userAgent

	// Detect OS
	let os = 'Unknown'
	if (ua.includes('Mac OS X') || ua.includes('Macintosh')) {
		os = 'macOS'
	} else if (ua.includes('Windows NT')) {
		os = 'Windows'
	} else if (ua.includes('Linux')) {
		if (ua.includes('Android')) {
			os = 'Android'
		} else {
			os = 'Linux'
		}
	} else if (ua.includes('CrOS')) {
		os = 'ChromeOS'
	} else if (ua.includes('iPhone') || ua.includes('iPad')) {
		os = 'iOS'
	}

	// Detect browser
	let browser = 'Browser'
	if (ua.includes('Chrome')) {
		browser = 'Chrome'
	} else if (ua.includes('Firefox')) {
		browser = 'Firefox'
	} else if (ua.includes('Safari') && !ua.includes('Chrome')) {
		browser = 'Safari'
	} else if (ua.includes('Edge')) {
		browser = 'Edge'
	}

	return `${browser} on ${os}`
}

// ==================== Storage Helpers ====================

/**
 * Save auth state to chrome.storage.local
 */
async function saveAuthState(state: AuthState): Promise<void> {
	await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: state })
}

/**
 * Get auth state from chrome.storage.local
 */
export async function getAuthState(): Promise<AuthState | null> {
	const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY)
	return stored[AUTH_STORAGE_KEY] || null
}

/**
 * Clear auth state from storage
 */
async function clearAuthState(): Promise<void> {
	await chrome.storage.local.remove(AUTH_STORAGE_KEY)
}

// ==================== API Helpers ====================

interface ApiResponse<T> {
	data?: T
	error?: string
}

/**
 * Make authenticated API request to auth server
 */
async function authFetch<T>(
	endpoint: string,
	body: Record<string, unknown>,
): Promise<ApiResponse<T>> {
	try {
		const response = await fetch(`${AUTH_URL}/${endpoint}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})

		const data = await response.json()

		if (!response.ok) {
			return { error: data.error || `Request failed with status ${response.status}` }
		}

		return { data: data as T }
	} catch (error) {
		return { error: error instanceof Error ? error.message : 'Network error' }
	}
}

// ==================== Auth Functions ====================

/**
 * Register a new user
 *
 * @param email - User's email address
 * @param password - User's password (minimum 8 characters)
 * @returns AuthState on success
 * @throws Error on failure
 */
export async function register(email: string, password: string): Promise<AuthState> {
	const deviceId = getDeviceId()
	const deviceName = getDeviceName()

	const response = await authFetch<{ token: string; user: AuthUser }>('register', {
		email,
		password,
		deviceId,
		deviceName,
	})

	if (response.error) {
		throw new Error(response.error)
	}

	const authState: AuthState = {
		token: response.data!.token,
		user: response.data!.user,
		deviceId,
	}

	await saveAuthState(authState)
	return authState
}

/**
 * Login existing user
 *
 * @param email - User's email address
 * @param password - User's password
 * @returns AuthState on success
 * @throws Error on failure
 */
export async function login(email: string, password: string): Promise<AuthState> {
	const deviceId = getDeviceId()
	const deviceName = getDeviceName()

	const response = await authFetch<{ token: string; user: AuthUser }>('login', {
		email,
		password,
		deviceId,
		deviceName,
	})

	if (response.error) {
		throw new Error(response.error)
	}

	const authState: AuthState = {
		token: response.data!.token,
		user: response.data!.user,
		deviceId,
	}

	await saveAuthState(authState)
	return authState
}

/**
 * Logout from current session
 * Clears local auth state and notifies server to invalidate session
 */
export async function logout(): Promise<void> {
	const state = await getAuthState()

	if (state?.token) {
		// Best effort - don't fail if server is unavailable
		try {
			await authFetch('logout', { token: state.token })
		} catch {
			// Ignore errors - still clear local state
		}
	}

	await clearAuthState()
}

/**
 * Logout from all sessions across all devices
 * Clears local auth state and notifies server to invalidate all sessions
 */
export async function logoutAll(): Promise<void> {
	const state = await getAuthState()

	if (state?.token) {
		try {
			await authFetch('logout-all', { token: state.token })
		} catch {
			// Ignore errors
		}
	}

	await clearAuthState()
}

/**
 * Get current auth token
 * @returns Token string or null if not authenticated
 */
export async function getToken(): Promise<string | null> {
	const state = await getAuthState()
	return state?.token || null
}

/**
 * Get current user info
 * @returns AuthUser or null if not authenticated
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
	const state = await getAuthState()
	return state?.user || null
}

/**
 * Check if user is authenticated
 * Verifies the token with the server and updates lastActiveAt
 *
 * @returns true if authenticated with valid token, false otherwise
 */
export async function isAuthenticated(): Promise<boolean> {
	const token = await getToken()
	if (!token) return false

	try {
		const response = await authFetch<{ valid: boolean }>('verify', { token })
		return response.data?.valid === true
	} catch {
		return false
	}
}

/**
 * Get all active sessions for the current user
 *
 * @returns Array of SessionInfo, or empty array if not authenticated
 */
export async function getSessions(): Promise<SessionInfo[]> {
	const state = await getAuthState()
	if (!state?.token) return []

	const response = await authFetch<{ sessions: SessionInfo[] }>('sessions', {
		token: state.token,
	})

	return response.data?.sessions || []
}

/**
 * Revoke a specific session
 * Use this to log out from a specific device
 *
 * @param sessionId - The session ID to revoke (from getSessions())
 */
export async function revokeSession(sessionId: string): Promise<void> {
	const state = await getAuthState()
	if (!state?.token) return

	await authFetch('revoke', {
		token: state.token,
		sessionToRevoke: sessionId,
	})
}

/**
 * Get the current device ID
 */
export function getCurrentDeviceId(): string {
	return getDeviceId()
}

/**
 * Get the current device name
 */
export function getCurrentDeviceName(): string {
	return getDeviceName()
}

// ==================== Auth State Change Listener ====================

type AuthStateListener = (state: AuthState | null) => void
const listeners: Set<AuthStateListener> = new Set()

/**
 * Subscribe to auth state changes
 * Useful for reactive UI updates
 *
 * @param listener - Callback function called when auth state changes
 * @returns Unsubscribe function
 */
export function onAuthStateChange(listener: AuthStateListener): () => void {
	listeners.add(listener)

	// Immediately call with current state
	getAuthState().then(listener)

	return () => {
		listeners.delete(listener)
	}
}

// Listen for storage changes to detect login/logout from other tabs
if (typeof chrome !== 'undefined' && chrome.storage) {
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === 'local' && changes[AUTH_STORAGE_KEY]) {
			const newState = changes[AUTH_STORAGE_KEY].newValue as AuthState | null
			listeners.forEach((listener) => listener(newState || null))
		}
	})
}
