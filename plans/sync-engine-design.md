# Papaya Bar Sync Engine Design

## Overview

This document outlines the architecture for a real-time sync engine that enables authenticated users to synchronize their browser tabs and saved sessions across multiple devices using PartyKit (WebSocket-based real-time infrastructure) deployed to Cloudflare.

## Goals

1. **Authentication**: Secure user authentication to identify and isolate user data
2. **Sync Sessions**: Synchronize saved sessions (currently in localStorage) across devices
3. **Sync Current Tabs** (optional): Share/sync currently open tabs across devices (read-only broadcast)
4. **Offline-First**: Work offline and sync when connection is restored
5. **Conflict Resolution**: Handle concurrent edits from multiple devices
6. **Minimal Latency**: Real-time updates using WebSockets
7. **Cost Effective**: Use hibernation to minimize resource usage

---

## Approach Comparison: Custom vs TinyBase

### Option A: Custom Sync Protocol (Original Design)

**Pros:**

- Full control over sync logic
- Simpler server code
- Lower client bundle size

**Cons:**

- Must implement conflict resolution manually
- More code to maintain
- No built-in CRDT support

### Option B: TinyBase + PartyKit (Recommended)

**Pros:**

- Built-in CRDT support via `MergeableStore` - automatic conflict resolution
- Native PartyKit integration (`persister-partykit-client` + `persister-partykit-server`)
- Reactive data store with listeners
- Tiny bundle size (~5.4kB - 12.1kB)
- Well-tested (100% coverage)
- Works with localStorage for offline persistence
- Schema validation support

**Cons:**

- Additional dependency
- `PartyKitPersister` doesn't work with `MergeableStore` (need to use WebSocket synchronizer instead)
- Learning curve for TinyBase API

### Recommendation: **TinyBase with WebSocket Synchronizer**

TinyBase's `MergeableStore` + `synchronizer-ws-client` is the best fit because:

1. Native CRDT support handles conflicts automatically (Last-Write-Wins at cell level)
2. Works great with PartyKit as the WebSocket transport
3. Can persist locally to localStorage/sessionStorage for offline support
4. Reactive - integrates well with Vue's reactivity system

---

## Current State Analysis

### Data Structures

```typescript
// From src/types.ts
type SaveableTab = {
	windowId: number
	stableId: string // Format: "stableId-{tab.id}"
	url?: string
	title?: string
	favIconUrl?: string
	id?: number
	active: boolean
	groupId?: number
}

// From src/hooks/useSessionsData.ts
type SavedData = {
	title: string
	description: string
	tabs: SaveableTab[]
	groups: Group[] // Chrome tab groups
	windows: SavedWindow[] // Window positions/sizes
	displays: SavedDisplay[] // Monitor info
}

// Current Storage
// Key: Date string format "hh:mm aaa MM/dd/yyyy"
// Value: SavedData
// Location: localStorage via VueUse useStorage('sessions:saved', Map<string, SavedData>)
```

### Current Storage Mechanisms

| Data Type | Storage               | Key                       |
| --------- | --------------------- | ------------------------- |
| Sessions  | localStorage (VueUse) | `sessions:saved`          |
| Settings  | chrome.storage.local  | `chonching-tabs-settings` |
| Dark Mode | localStorage          | `vueuse-color-scheme`     |

### Existing Chrome Permissions (relevant)

- `identity` - Available but unused (for OAuth)
- `storage` - chrome.storage API
- `unlimitedStorage` - For large data

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser Extension                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │   Local State   │  │   Sync Client   │  │   Auth Module       │  │
│  │   (IndexedDB)   │◄─┤   (PartySocket) │◄─┤   (OAuth/JWT)       │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────────┘  │
│           │                    │                                     │
└───────────┼────────────────────┼─────────────────────────────────────┘
            │                    │
            │                    │ WebSocket + HTTP
            │                    ▼
┌───────────┴────────────────────────────────────────────────────────┐
│                        PartyKit (Cloudflare)                        │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Auth Party                              │   │
│  │  - Token validation                                          │   │
│  │  - User session management                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    User Sync Party                           │   │
│  │  - Room ID = user_id                                         │   │
│  │  - Stores sessions per user                                  │   │
│  │  - Broadcasts changes to all connected devices               │   │
│  │  - Conflict resolution (CRDT / Last-Write-Wins)              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Live Tabs Party (Optional)                  │   │
│  │  - Room ID = user_id                                         │   │
│  │  - Ephemeral current tab state                               │   │
│  │  - No persistence (memory only)                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Party Architecture

```
partykit.json
{
  "name": "papaya-bar-sync",
  "main": "party/sessions.ts",
  "parties": {
    "auth": "party/auth.ts",
    "tabs": "party/live-tabs.ts"
  }
}
```

---

## TinyBase Architecture (Recommended Approach)

### Why TinyBase?

TinyBase is a reactive data store with native CRDT support that integrates perfectly with PartyKit:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser Extension                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    TinyBase MergeableStore                    │   │
│  │  - Reactive data with listeners                               │   │
│  │  - Automatic CRDT conflict resolution                         │   │
│  │  - Cell-level Last-Write-Wins                                 │   │
│  └──────────────────┬───────────────────────────────────────────┘   │
│                     │                                                │
│         ┌───────────┴───────────┐                                   │
│         │                       │                                   │
│         ▼                       ▼                                   │
│  ┌─────────────────┐    ┌─────────────────┐                         │
│  │ LocalPersister  │    │ WsSynchronizer  │                         │
│  │ (localStorage)  │    │ (PartySocket)   │                         │
│  │ Offline cache   │    │ Real-time sync  │                         │
│  └─────────────────┘    └────────┬────────┘                         │
│                                  │                                   │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │ WebSocket
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     PartyKit (Cloudflare)                            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                   WsServerDurableObject                        │ │
│  │  - TinyBase synchronizer server                                │ │
│  │  - Room ID = user_id                                           │ │
│  │  - Persists to Durable Object storage                          │ │
│  │  - Handles merge/broadcast automatically                       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      Auth Party (HTTP)                         │ │
│  │  - Email/password registration & login                         │ │
│  │  - JWT token generation & verification                         │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### TinyBase Data Model

```typescript
// Map our session data to TinyBase tables

// Tables Schema
const sessionsSchema = {
	sessions: {
		id: { type: 'string' },
		title: { type: 'string' },
		description: { type: 'string' },
		createdAt: { type: 'number' },
		updatedAt: { type: 'number' },
	},
	tabs: {
		sessionId: { type: 'string' }, // Foreign key to sessions
		stableId: { type: 'string' },
		url: { type: 'string' },
		title: { type: 'string' },
		favIconUrl: { type: 'string' },
		windowId: { type: 'number' },
		groupId: { type: 'number' },
		active: { type: 'boolean', default: false },
		index: { type: 'number' }, // For ordering
	},
	groups: {
		sessionId: { type: 'string' },
		groupId: { type: 'number' },
		title: { type: 'string' },
		color: { type: 'string' },
		collapsed: { type: 'boolean', default: false },
	},
	windows: {
		sessionId: { type: 'string' },
		windowId: { type: 'number' },
		width: { type: 'number' },
		height: { type: 'number' },
		left: { type: 'number' },
		top: { type: 'number' },
	},
}
```

### TinyBase Client Setup

```typescript
// src/sync/store.ts
import { createMergeableStore } from 'tinybase'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { getToken, getCurrentUser } from './auth'

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

// Create a MergeableStore (CRDT-enabled)
export const store = createMergeableStore('papaya-sessions')

// Set up schema
store.setTablesSchema({
	sessions: {
		title: { type: 'string', default: '' },
		description: { type: 'string', default: '' },
		createdAt: { type: 'number' },
		updatedAt: { type: 'number' },
	},
	tabs: {
		sessionId: { type: 'string' },
		stableId: { type: 'string' },
		url: { type: 'string', default: '' },
		title: { type: 'string', default: '' },
		favIconUrl: { type: 'string', default: '' },
		windowId: { type: 'number', default: 0 },
		groupId: { type: 'number', default: -1 },
		active: { type: 'boolean', default: false },
		index: { type: 'number', default: 0 },
	},
	groups: {
		sessionId: { type: 'string' },
		originalId: { type: 'number' },
		title: { type: 'string', default: '' },
		color: { type: 'string', default: 'grey' },
		collapsed: { type: 'boolean', default: false },
	},
	windows: {
		sessionId: { type: 'string' },
		originalId: { type: 'number' },
		width: { type: 'number' },
		height: { type: 'number' },
		left: { type: 'number' },
		top: { type: 'number' },
	},
})

// Local persistence (offline support)
let localPersister: ReturnType<typeof createLocalPersister> | null = null
let synchronizer: Awaited<ReturnType<typeof createWsSynchronizer>> | null = null

export async function initializeStore() {
	// Set up local persistence first (works offline)
	localPersister = createLocalPersister(store, 'papaya:sessions:store')
	await localPersister.startAutoLoad()
	await localPersister.startAutoSave()
}

export async function startSync() {
	const user = await getCurrentUser()
	const token = await getToken()

	if (!user || !token) {
		throw new Error('Not authenticated')
	}

	// Create WebSocket URL with auth
	const protocol = PARTYKIT_HOST.includes('localhost') ? 'ws' : 'wss'
	const wsUrl = `${protocol}://${PARTYKIT_HOST}/parties/sync/${user.id}?token=${encodeURIComponent(token)}`

	// Create WebSocket synchronizer
	const ws = new WebSocket(wsUrl)

	synchronizer = await createWsSynchronizer(store, ws)
	await synchronizer.startSync()

	return synchronizer
}

export async function stopSync() {
	if (synchronizer) {
		await synchronizer.stopSync()
		await synchronizer.destroy()
		synchronizer = null
	}
}

export function getSyncStatus() {
	return {
		isLocalPersisting: localPersister !== null,
		isSyncing: synchronizer !== null,
	}
}
```

### TinyBase PartyKit Server (Sync Party)

```typescript
// party/sync.ts
import type * as Party from 'partykit/server'
import { createMergeableStore } from 'tinybase'
import { createWsServerDurableObject } from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'

// This is a simplified approach - TinyBase handles all the sync logic
export default class SyncServer implements Party.Server {
	store: ReturnType<typeof createMergeableStore>
	wsServer: ReturnType<typeof createWsServerDurableObject>

	constructor(readonly room: Party.Room) {
		// Each user gets their own MergeableStore (room ID = user ID)
		this.store = createMergeableStore(`user-${room.id}`)
		this.wsServer = createWsServerDurableObject(this.store)
	}

	// Authenticate before allowing connection - validates against auth party's session storage
	static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
		const url = new URL(request.url)
		const token = url.searchParams.get('token')

		if (!token) {
			return new Response('Unauthorized: No token', { status: 401 })
		}

		try {
			// Validate token by calling the auth party
			// The auth party stores sessions, so we need to verify the token exists there
			const authParty = lobby.parties.auth
			const authRoom = authParty.get('main')

			const verifyResponse = await authRoom.fetch(
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token }),
				},
				'/verify',
			)

			if (!verifyResponse.ok) {
				return new Response('Unauthorized: Invalid session', { status: 401 })
			}

			const sessionData = (await verifyResponse.json()) as {
				valid: boolean
				user?: { id: string }
			}

			if (!sessionData.valid || !sessionData.user) {
				return new Response('Unauthorized: Invalid session', { status: 401 })
			}

			// Check that user ID matches the room they're trying to access
			const roomId = url.pathname.split('/').pop()
			if (sessionData.user.id !== roomId) {
				return new Response('Forbidden: User mismatch', { status: 403 })
			}

			// Pass user info in headers for use in onConnect
			request.headers.set('X-User-ID', sessionData.user.id)

			return request
		} catch (e) {
			console.error('Auth error:', e)
			return new Response('Unauthorized', { status: 401 })
		}
	}

	async onStart() {
		// Load persisted state from Durable Object storage
		const stored = await this.room.storage.get<string>('store')
		if (stored) {
			// TinyBase can import from JSON
			this.store.setContent(JSON.parse(stored))
		}

		// Auto-save changes to storage
		this.store.addTablesListener(() => {
			this.room.storage.put('store', JSON.stringify(this.store.getContent()))
		})
	}

	onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
		// TinyBase WsServer handles the sync protocol
		this.wsServer.onConnection(connection as unknown as WebSocket)
	}

	onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
		// TinyBase WsServer handles messages
		this.wsServer.onMessage(sender as unknown as WebSocket, message)
	}

	onClose(connection: Party.Connection) {
		this.wsServer.onClose(connection as unknown as WebSocket)
	}
}
```

### Vue Composable for TinyBase

```typescript
// src/hooks/useTinyBaseStore.ts
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { store, initializeStore, startSync, stopSync } from '@/sync/store'
import { getCurrentUser, isAuthenticated } from '@/sync/auth'
import type { SavedData, SaveableTab, Group } from '@/types'

export function useTinyBaseStore() {
	const isInitialized = ref(false)
	const isSyncing = ref(false)
	const syncError = ref<Error | null>(null)
	const user = ref<{ id: string; email: string } | null>(null)

	// Reactive sessions list
	const sessions = ref<Array<{ id: string; data: SavedData }>>([])

	// Listen to store changes
	let listenerId: string | null = null

	const refreshSessions = () => {
		const sessionsTable = store.getTable('sessions')
		const tabsTable = store.getTable('tabs')
		const groupsTable = store.getTable('groups')
		const windowsTable = store.getTable('windows')

		sessions.value = Object.entries(sessionsTable)
			.map(([id, session]) => {
				// Get tabs for this session
				const sessionTabs = Object.entries(tabsTable)
					.filter(([, tab]) => tab.sessionId === id)
					.map(([tabId, tab]) => ({
						stableId: tab.stableId as string,
						url: tab.url as string,
						title: tab.title as string,
						favIconUrl: tab.favIconUrl as string,
						windowId: tab.windowId as number,
						groupId: tab.groupId as number,
						active: tab.active as boolean,
						id: parseInt(tabId),
					}))
					.sort(
						(a, b) =>
							((store.getCell('tabs', a.stableId, 'index') as number) || 0) -
							((store.getCell('tabs', b.stableId, 'index') as number) || 0),
					)

				// Get groups for this session
				const sessionGroups = Object.entries(groupsTable)
					.filter(([, group]) => group.sessionId === id)
					.map(([groupId, group]) => ({
						id: group.originalId as number,
						title: group.title as string,
						color: group.color as chrome.tabGroups.ColorEnum,
						collapsed: group.collapsed as boolean,
						windowId: 0, // Will be determined by tabs
					}))

				// Get windows for this session
				const sessionWindows = Object.entries(windowsTable)
					.filter(([, win]) => win.sessionId === id)
					.map(([, win]) => ({
						id: win.originalId as number,
						width: win.width as number,
						height: win.height as number,
						left: win.left as number,
						top: win.top as number,
					}))

				return {
					id,
					data: {
						title: session.title as string,
						description: session.description as string,
						tabs: sessionTabs,
						groups: sessionGroups as Group[],
						windows: sessionWindows,
						displays: [], // Not stored in TinyBase, captured at restore time
					},
				}
			})
			.sort(
				(a, b) =>
					((store.getCell('sessions', b.id, 'updatedAt') as number) || 0) -
					((store.getCell('sessions', a.id, 'updatedAt') as number) || 0),
			)
	}

	// Initialize
	onMounted(async () => {
		await initializeStore()
		isInitialized.value = true

		// Set up listener for reactive updates
		listenerId = store.addTablesListener(() => {
			refreshSessions()
		})

		refreshSessions()

		// Check if already authenticated and start sync
		if (await isAuthenticated()) {
			user.value = await getCurrentUser()
			try {
				await startSync()
				isSyncing.value = true
			} catch (e) {
				syncError.value = e as Error
			}
		}
	})

	onUnmounted(() => {
		if (listenerId) {
			store.delListener(listenerId)
		}
		stopSync()
	})

	// Actions
	const createSession = (data: SavedData) => {
		const sessionId = crypto.randomUUID()
		const now = Date.now()

		// Create session
		store.setRow('sessions', sessionId, {
			title: data.title,
			description: data.description,
			createdAt: now,
			updatedAt: now,
		})

		// Create tabs
		data.tabs.forEach((tab, index) => {
			const tabId = `${sessionId}-${tab.stableId}`
			store.setRow('tabs', tabId, {
				sessionId,
				stableId: tab.stableId,
				url: tab.url || '',
				title: tab.title || '',
				favIconUrl: tab.favIconUrl || '',
				windowId: tab.windowId,
				groupId: tab.groupId || -1,
				active: tab.active,
				index,
			})
		})

		// Create groups
		data.groups.forEach((group) => {
			const groupRowId = `${sessionId}-group-${group.id}`
			store.setRow('groups', groupRowId, {
				sessionId,
				originalId: group.id,
				title: group.title || '',
				color: group.color,
				collapsed: group.collapsed,
			})
		})

		// Create windows
		data.windows.forEach((win) => {
			const winRowId = `${sessionId}-win-${win.id}`
			store.setRow('windows', winRowId, {
				sessionId,
				originalId: win.id,
				width: win.width,
				height: win.height,
				left: win.left,
				top: win.top,
			})
		})

		return sessionId
	}

	const updateSession = (sessionId: string, data: Partial<SavedData>) => {
		if (data.title !== undefined) {
			store.setCell('sessions', sessionId, 'title', data.title)
		}
		if (data.description !== undefined) {
			store.setCell('sessions', sessionId, 'description', data.description)
		}
		store.setCell('sessions', sessionId, 'updatedAt', Date.now())
	}

	const deleteSession = (sessionId: string) => {
		// Delete related data first
		const tabsTable = store.getTable('tabs')
		const groupsTable = store.getTable('groups')
		const windowsTable = store.getTable('windows')

		Object.keys(tabsTable).forEach((tabId) => {
			if (store.getCell('tabs', tabId, 'sessionId') === sessionId) {
				store.delRow('tabs', tabId)
			}
		})

		Object.keys(groupsTable).forEach((groupId) => {
			if (store.getCell('groups', groupId, 'sessionId') === sessionId) {
				store.delRow('groups', groupId)
			}
		})

		Object.keys(windowsTable).forEach((winId) => {
			if (store.getCell('windows', winId, 'sessionId') === sessionId) {
				store.delRow('windows', winId)
			}
		})

		// Delete session
		store.delRow('sessions', sessionId)
	}

	const connect = async () => {
		if (!(await isAuthenticated())) {
			throw new Error('Not authenticated')
		}

		user.value = await getCurrentUser()

		try {
			await startSync()
			isSyncing.value = true
			syncError.value = null
		} catch (e) {
			syncError.value = e as Error
			throw e
		}
	}

	const disconnect = async () => {
		await stopSync()
		isSyncing.value = false
	}

	return {
		// State
		sessions: computed(() => sessions.value),
		isInitialized,
		isSyncing,
		syncError,
		user,

		// Actions
		createSession,
		updateSession,
		deleteSession,
		connect,
		disconnect,

		// Direct store access for advanced use
		store,
	}
}
```

---

## Component Details

### 1. Authentication Module

#### Authentication Options Comparison

| Method                           | Complexity | User Experience                        | Setup Required             |
| -------------------------------- | ---------- | -------------------------------------- | -------------------------- |
| **Email/Password (Recommended)** | Medium     | Familiar, no Google account needed     | Auth server needed         |
| Google OAuth (Chrome Identity)   | Low        | One-click, but requires Google account | Google Cloud Console setup |
| Magic Link                       | Low        | Simple, passwordless                   | Email service needed       |

#### Option A: Email/Password with Database-Backed Sessions (Recommended)

**Why Database-Backed Sessions over JWTs:**

1. **Revocable** - Can invalidate sessions immediately (logout from all devices, security breach)
2. **Trackable** - See all active sessions, devices, last activity time
3. **No expiration complexity** - Token valid as long as it exists in DB
4. **Simpler security** - No JWT secret rotation, no token refresh dance
5. **Device management** - Users can see and revoke specific device sessions

**Data Model:**

```typescript
// Users table
interface User {
	id: string
	email: string
	passwordHash: string
	createdAt: number
}

// Sessions table (database-backed tokens)
interface Session {
	id: string // The token itself (random string)
	userId: string // Foreign key to user
	deviceName: string // "Chrome on MacOS", etc.
	deviceId: string // Stable device identifier
	createdAt: number
	lastActiveAt: number // Updated on each API call
	expiresAt: number // Optional expiration (e.g., 30 days of inactivity)
}
```

**Implementation: Auth API on PartyKit with Session Storage**

```typescript
// party/auth.ts
import type * as Party from 'partykit/server'

interface User {
	id: string
	email: string
	passwordHash: string
	createdAt: number
}

interface Session {
	id: string
	userId: string
	userEmail: string
	deviceName: string
	deviceId: string
	createdAt: number
	lastActiveAt: number
}

// Use PartyKit as auth server with database-backed sessions
// Room ID: "main" (single global room for auth)
export default class AuthServer implements Party.Server {
	constructor(readonly room: Party.Room) {}

	async onRequest(request: Party.Request) {
		const url = new URL(request.url)

		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders })
		}

		const body = request.method !== 'DELETE' ? ((await request.json()) as any) : {}

		// --- REGISTER ---
		if (url.pathname.endsWith('/register') && request.method === 'POST') {
			const { email, password, deviceName, deviceId } = body

			if (!email || !password) {
				return this.jsonResponse({ error: 'Email and password required' }, 400, corsHeaders)
			}

			// Normalize email
			const normalizedEmail = email.toLowerCase().trim()

			// Check if user exists
			const existingUser = await this.room.storage.get<User>(`user:${normalizedEmail}`)
			if (existingUser) {
				return this.jsonResponse({ error: 'User already exists' }, 409, corsHeaders)
			}

			// Hash password
			const passwordHash = await this.hashPassword(password)

			const user: User = {
				id: crypto.randomUUID(),
				email: normalizedEmail,
				passwordHash,
				createdAt: Date.now(),
			}

			await this.room.storage.put(`user:${normalizedEmail}`, user)

			// Create session token
			const session = await this.createSession(
				user,
				deviceName || 'Unknown Device',
				deviceId || crypto.randomUUID(),
			)

			return this.jsonResponse(
				{
					token: session.id,
					user: { id: user.id, email: user.email },
				},
				200,
				corsHeaders,
			)
		}

		// --- LOGIN ---
		if (url.pathname.endsWith('/login') && request.method === 'POST') {
			const { email, password, deviceName, deviceId } = body

			const normalizedEmail = email?.toLowerCase().trim()
			const user = await this.room.storage.get<User>(`user:${normalizedEmail}`)

			if (!user) {
				return this.jsonResponse({ error: 'Invalid credentials' }, 401, corsHeaders)
			}

			const valid = await this.verifyPassword(password, user.passwordHash)
			if (!valid) {
				return this.jsonResponse({ error: 'Invalid credentials' }, 401, corsHeaders)
			}

			// Create new session
			const session = await this.createSession(
				user,
				deviceName || 'Unknown Device',
				deviceId || crypto.randomUUID(),
			)

			return this.jsonResponse(
				{
					token: session.id,
					user: { id: user.id, email: user.email },
				},
				200,
				corsHeaders,
			)
		}

		// --- VERIFY TOKEN (also updates lastActiveAt) ---
		if (url.pathname.endsWith('/verify') && request.method === 'POST') {
			const { token } = body

			const session = await this.getSession(token)
			if (!session) {
				return this.jsonResponse({ valid: false }, 401, corsHeaders)
			}

			// Update last active time
			session.lastActiveAt = Date.now()
			await this.room.storage.put(`session:${token}`, session)

			return this.jsonResponse(
				{
					valid: true,
					user: { id: session.userId, email: session.userEmail },
				},
				200,
				corsHeaders,
			)
		}

		// --- LOGOUT (delete single session) ---
		if (url.pathname.endsWith('/logout') && request.method === 'POST') {
			const { token } = body

			const session = await this.getSession(token)
			if (session) {
				await this.room.storage.delete(`session:${token}`)
				// Remove from user's session list
				await this.removeSessionFromUser(session.userId, token)
			}

			return this.jsonResponse({ success: true }, 200, corsHeaders)
		}

		// --- LOGOUT ALL (delete all sessions for user) ---
		if (url.pathname.endsWith('/logout-all') && request.method === 'POST') {
			const { token } = body

			const session = await this.getSession(token)
			if (session) {
				await this.deleteAllUserSessions(session.userId)
			}

			return this.jsonResponse({ success: true }, 200, corsHeaders)
		}

		// --- LIST SESSIONS (get all active sessions for user) ---
		if (url.pathname.endsWith('/sessions') && request.method === 'POST') {
			const { token } = body

			const session = await this.getSession(token)
			if (!session) {
				return this.jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
			}

			const sessions = await this.getUserSessions(session.userId)

			return this.jsonResponse(
				{
					sessions: sessions.map((s) => ({
						id: s.id,
						deviceName: s.deviceName,
						createdAt: s.createdAt,
						lastActiveAt: s.lastActiveAt,
						isCurrent: s.id === token,
					})),
				},
				200,
				corsHeaders,
			)
		}

		// --- REVOKE SESSION (delete specific session) ---
		if (url.pathname.endsWith('/revoke') && request.method === 'POST') {
			const { token, sessionToRevoke } = body

			const session = await this.getSession(token)
			if (!session) {
				return this.jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
			}

			const targetSession = await this.getSession(sessionToRevoke)
			if (targetSession && targetSession.userId === session.userId) {
				await this.room.storage.delete(`session:${sessionToRevoke}`)
				await this.removeSessionFromUser(session.userId, sessionToRevoke)
			}

			return this.jsonResponse({ success: true }, 200, corsHeaders)
		}

		return this.jsonResponse({ error: 'Not found' }, 404, corsHeaders)
	}

	// --- Helper Methods ---

	private jsonResponse(data: any, status: number, corsHeaders: Record<string, string>) {
		return new Response(JSON.stringify(data), {
			status,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		})
	}

	private async hashPassword(password: string): Promise<string> {
		const salt = crypto.randomUUID()
		const encoder = new TextEncoder()
		const data = encoder.encode(salt + password)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
		return `${salt}:${hashHex}`
	}

	private async verifyPassword(password: string, hash: string): Promise<boolean> {
		const [salt, storedHash] = hash.split(':')
		const encoder = new TextEncoder()
		const data = encoder.encode(salt + password)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
		return hashHex === storedHash
	}

	private generateToken(): string {
		// Generate a secure random token (32 bytes = 256 bits)
		const bytes = new Uint8Array(32)
		crypto.getRandomValues(bytes)
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	}

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

	private async getSession(token: string): Promise<Session | null> {
		if (!token) return null
		return (await this.room.storage.get<Session>(`session:${token}`)) || null
	}

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

	private async removeSessionFromUser(userId: string, sessionId: string): Promise<void> {
		const userSessions =
			(await this.room.storage.get<string[]>(`user-sessions:${userId}`)) || []
		const filtered = userSessions.filter((id) => id !== sessionId)
		await this.room.storage.put(`user-sessions:${userId}`, filtered)
	}

	private async deleteAllUserSessions(userId: string): Promise<void> {
		const sessionIds = (await this.room.storage.get<string[]>(`user-sessions:${userId}`)) || []

		for (const id of sessionIds) {
			await this.room.storage.delete(`session:${id}`)
		}

		await this.room.storage.put(`user-sessions:${userId}`, [])
	}
}
```

**Client-Side Auth Module:**

```typescript
// src/sync/auth.ts
const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'
const AUTH_URL = PARTYKIT_HOST.includes('localhost')
	? `http://${PARTYKIT_HOST}/parties/auth/main`
	: `https://${PARTYKIT_HOST}/parties/auth/main`

export interface AuthUser {
	id: string
	email: string
}

export interface AuthState {
	token: string
	user: AuthUser
	deviceId: string
}

export interface SessionInfo {
	id: string
	deviceName: string
	createdAt: number
	lastActiveAt: number
	isCurrent: boolean
}

// Get or create a stable device ID
function getDeviceId(): string {
	let deviceId = localStorage.getItem('papaya:deviceId')
	if (!deviceId) {
		deviceId = crypto.randomUUID()
		localStorage.setItem('papaya:deviceId', deviceId)
	}
	return deviceId
}

// Get device name from user agent
function getDeviceName(): string {
	const ua = navigator.userAgent
	if (ua.includes('Mac')) return 'Chrome on macOS'
	if (ua.includes('Windows')) return 'Chrome on Windows'
	if (ua.includes('Linux')) return 'Chrome on Linux'
	if (ua.includes('CrOS')) return 'Chrome on ChromeOS'
	return 'Chrome Browser'
}

// Register a new user
export async function register(email: string, password: string): Promise<AuthState> {
	const deviceId = getDeviceId()
	const deviceName = getDeviceName()

	const response = await fetch(`${AUTH_URL}/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password, deviceId, deviceName }),
	})

	if (!response.ok) {
		const error = await response.json()
		throw new Error(error.error || 'Registration failed')
	}

	const data = await response.json()
	const authState: AuthState = { ...data, deviceId }
	await saveAuthState(authState)
	return authState
}

// Login existing user
export async function login(email: string, password: string): Promise<AuthState> {
	const deviceId = getDeviceId()
	const deviceName = getDeviceName()

	const response = await fetch(`${AUTH_URL}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password, deviceId, deviceName }),
	})

	if (!response.ok) {
		const error = await response.json()
		throw new Error(error.error || 'Login failed')
	}

	const data = await response.json()
	const authState: AuthState = { ...data, deviceId }
	await saveAuthState(authState)
	return authState
}

// Logout current session
export async function logout(): Promise<void> {
	const state = await getAuthState()
	if (state?.token) {
		try {
			await fetch(`${AUTH_URL}/logout`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: state.token }),
			})
		} catch {
			// Ignore errors - still clear local state
		}
	}
	await chrome.storage.local.remove('papaya:auth')
}

// Logout from all devices
export async function logoutAll(): Promise<void> {
	const state = await getAuthState()
	if (state?.token) {
		try {
			await fetch(`${AUTH_URL}/logout-all`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: state.token }),
			})
		} catch {
			// Ignore errors
		}
	}
	await chrome.storage.local.remove('papaya:auth')
}

// Get all active sessions
export async function getSessions(): Promise<SessionInfo[]> {
	const state = await getAuthState()
	if (!state?.token) return []

	const response = await fetch(`${AUTH_URL}/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token: state.token }),
	})

	if (!response.ok) return []

	const data = await response.json()
	return data.sessions || []
}

// Revoke a specific session
export async function revokeSession(sessionId: string): Promise<void> {
	const state = await getAuthState()
	if (!state?.token) return

	await fetch(`${AUTH_URL}/revoke`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token: state.token, sessionToRevoke: sessionId }),
	})
}

// Get current auth state
export async function getAuthState(): Promise<AuthState | null> {
	const stored = await chrome.storage.local.get('papaya:auth')
	return stored['papaya:auth'] || null
}

// Get just the token
export async function getToken(): Promise<string | null> {
	const state = await getAuthState()
	return state?.token || null
}

// Get current user
export async function getCurrentUser(): Promise<AuthUser | null> {
	const state = await getAuthState()
	return state?.user || null
}

// Check if token is still valid (and update lastActiveAt)
export async function isAuthenticated(): Promise<boolean> {
	const token = await getToken()
	if (!token) return false

	try {
		const response = await fetch(`${AUTH_URL}/verify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token }),
		})
		const data = await response.json()
		return data.valid === true
	} catch {
		return false
	}
}

// Save auth state
async function saveAuthState(state: AuthState): Promise<void> {
	await chrome.storage.local.set({ 'papaya:auth': state })
}
```

**Client-Side Auth Module:**

```typescript
// src/sync/auth.ts
const AUTH_URL = import.meta.env.VITE_PARTYKIT_HOST
	? `https://${import.meta.env.VITE_PARTYKIT_HOST}/parties/auth/main`
	: 'http://localhost:1999/parties/auth/main'

export interface AuthUser {
	id: string
	email: string
}

export interface AuthState {
	token: string
	user: AuthUser
}

// Register a new user
export async function register(email: string, password: string): Promise<AuthState> {
	const response = await fetch(`${AUTH_URL}/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	})

	if (!response.ok) {
		const error = await response.json()
		throw new Error(error.error || 'Registration failed')
	}

	const data = await response.json()
	await saveAuthState(data)
	return data
}

// Login existing user
export async function login(email: string, password: string): Promise<AuthState> {
	const response = await fetch(`${AUTH_URL}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	})

	if (!response.ok) {
		const error = await response.json()
		throw new Error(error.error || 'Login failed')
	}

	const data = await response.json()
	await saveAuthState(data)
	return data
}

// Logout
export async function logout(): Promise<void> {
	await chrome.storage.local.remove('papaya:auth')
}

// Get current auth state
export async function getAuthState(): Promise<AuthState | null> {
	const stored = await chrome.storage.local.get('papaya:auth')
	return stored['papaya:auth'] || null
}

// Get just the token
export async function getToken(): Promise<string | null> {
	const state = await getAuthState()
	return state?.token || null
}

// Get current user
export async function getCurrentUser(): Promise<AuthUser | null> {
	const state = await getAuthState()
	return state?.user || null
}

// Check if token is still valid
export async function isAuthenticated(): Promise<boolean> {
	const token = await getToken()
	if (!token) return false

	try {
		const response = await fetch(`${AUTH_URL}/verify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token }),
		})
		const data = await response.json()
		return data.valid === true
	} catch {
		return false
	}
}

// Save auth state
async function saveAuthState(state: AuthState): Promise<void> {
	await chrome.storage.local.set({ 'papaya:auth': state })
}
```

#### Option B: Google OAuth via Chrome Identity API

Still available if you prefer Google sign-in:

```typescript
// src/sync/auth-google.ts
export async function signInWithGoogle(): Promise<AuthUser> {
	return new Promise((resolve, reject) => {
		chrome.identity.getAuthToken({ interactive: true }, async (token) => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError)
				return
			}

			const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
				headers: { Authorization: `Bearer ${token}` },
			})
			const userInfo = await response.json()

			await chrome.storage.local.set({
				'papaya:auth': {
					accessToken: token,
					user: {
						id: userInfo.sub,
						email: userInfo.email,
						name: userInfo.name,
						avatar: userInfo.picture,
					},
				},
			})

			resolve(userInfo)
		})
	})
}
```

**Manifest Updates Required (only for Google OAuth):**

```json
{
	"oauth2": {
		"client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
		"scopes": [
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile"
		]
	},
	"key": "YOUR_EXTENSION_KEY"
}
```

### 2. PartyKit Server - Sessions Sync Party

```typescript
// party/sessions.ts
import type * as Party from 'partykit/server'

// Sync protocol message types
interface SyncMessage {
	type:
		| 'sync_request'
		| 'sync_response'
		| 'session_create'
		| 'session_update'
		| 'session_delete'
		| 'full_sync'
	payload: any
	timestamp: number
	deviceId: string
	version?: number
}

interface StoredSession {
	id: string // UUID (replacing date-based keys)
	data: SavedData
	version: number // For conflict resolution
	updatedAt: number // Timestamp
	createdAt: number
	deletedAt?: number // Soft delete for sync
}

interface UserSyncState {
	sessions: Record<string, StoredSession>
	lastSync: number
	version: number
}

export default class SessionsSyncServer implements Party.Server {
	options: Party.ServerOptions = {
		hibernate: true, // Enable hibernation for cost efficiency
	}

	constructor(readonly room: Party.Room) {}

	// Validate Google OAuth token
	static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
		try {
			const token = new URL(request.url).searchParams.get('token')
			if (!token) {
				return new Response('Unauthorized: No token', { status: 401 })
			}

			// Verify token with Google
			const response = await fetch(
				`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
			)

			if (!response.ok) {
				return new Response('Unauthorized: Invalid token', { status: 401 })
			}

			const tokenInfo = await response.json()

			// Verify the room ID matches the user ID from token
			const roomId = new URL(request.url).pathname.split('/').pop()
			if (tokenInfo.sub !== roomId) {
				return new Response('Unauthorized: User mismatch', { status: 403 })
			}

			// Pass user info to connection context
			request.headers.set('X-User-ID', tokenInfo.sub)
			request.headers.set('X-User-Email', tokenInfo.email)

			return request
		} catch (e) {
			return new Response('Unauthorized', { status: 401 })
		}
	}

	// Called when server wakes from hibernation
	async onStart() {
		// With hibernation, we load state on-demand, not here
		// This keeps wake-up fast
	}

	async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
		const userId = ctx.request.headers.get('X-User-ID')
		const deviceId = new URL(ctx.request.url).searchParams.get('deviceId') || 'unknown'

		// Store device info on connection
		connection.setState({ userId, deviceId })

		// Send current state to newly connected client
		const sessions = await this.getAllSessions()
		const lastSync = (await this.room.storage.get<number>('lastSync')) || 0

		connection.send(
			JSON.stringify({
				type: 'full_sync',
				payload: {
					sessions,
					lastSync,
					serverTime: Date.now(),
				},
			}),
		)

		// Notify other devices of new connection
		this.room.broadcast(
			JSON.stringify({
				type: 'device_connected',
				payload: { deviceId },
			}),
			[connection.id],
		)
	}

	async onMessage(message: string, sender: Party.Connection) {
		const msg: SyncMessage = JSON.parse(message)

		switch (msg.type) {
			case 'session_create':
				await this.handleSessionCreate(msg, sender)
				break

			case 'session_update':
				await this.handleSessionUpdate(msg, sender)
				break

			case 'session_delete':
				await this.handleSessionDelete(msg, sender)
				break

			case 'sync_request':
				await this.handleSyncRequest(msg, sender)
				break
		}
	}

	async onClose(connection: Party.Connection) {
		const state = connection.state as { deviceId?: string }
		if (state?.deviceId) {
			this.room.broadcast(
				JSON.stringify({
					type: 'device_disconnected',
					payload: { deviceId: state.deviceId },
				}),
			)
		}
	}

	// --- Session Handlers ---

	private async handleSessionCreate(msg: SyncMessage, sender: Party.Connection) {
		const { id, data } = msg.payload

		const session: StoredSession = {
			id,
			data,
			version: 1,
			createdAt: msg.timestamp,
			updatedAt: msg.timestamp,
		}

		await this.room.storage.put(`session:${id}`, session)
		await this.updateLastSync(msg.timestamp)

		// Broadcast to all other connected devices
		this.room.broadcast(
			JSON.stringify({
				type: 'session_created',
				payload: session,
				timestamp: Date.now(),
			}),
			[sender.id],
		)

		// Acknowledge to sender
		sender.send(
			JSON.stringify({
				type: 'session_create_ack',
				payload: { id, version: 1 },
			}),
		)
	}

	private async handleSessionUpdate(msg: SyncMessage, sender: Party.Connection) {
		const { id, data, expectedVersion } = msg.payload

		const existing = await this.room.storage.get<StoredSession>(`session:${id}`)

		if (!existing) {
			sender.send(
				JSON.stringify({
					type: 'error',
					payload: { code: 'NOT_FOUND', message: 'Session not found', id },
				}),
			)
			return
		}

		// Optimistic concurrency check
		if (expectedVersion && existing.version !== expectedVersion) {
			// Conflict! Send current state back for client-side resolution
			sender.send(
				JSON.stringify({
					type: 'conflict',
					payload: {
						id,
						serverVersion: existing,
						clientVersion: msg.payload,
					},
				}),
			)
			return
		}

		const updated: StoredSession = {
			...existing,
			data: { ...existing.data, ...data },
			version: existing.version + 1,
			updatedAt: msg.timestamp,
		}

		await this.room.storage.put(`session:${id}`, updated)
		await this.updateLastSync(msg.timestamp)

		// Broadcast update
		this.room.broadcast(
			JSON.stringify({
				type: 'session_updated',
				payload: updated,
				timestamp: Date.now(),
			}),
			[sender.id],
		)

		sender.send(
			JSON.stringify({
				type: 'session_update_ack',
				payload: { id, version: updated.version },
			}),
		)
	}

	private async handleSessionDelete(msg: SyncMessage, sender: Party.Connection) {
		const { id } = msg.payload

		const existing = await this.room.storage.get<StoredSession>(`session:${id}`)

		if (existing) {
			// Soft delete - keep for sync purposes with tombstone
			const deleted: StoredSession = {
				...existing,
				deletedAt: msg.timestamp,
				version: existing.version + 1,
				updatedAt: msg.timestamp,
			}

			await this.room.storage.put(`session:${id}`, deleted)
			await this.updateLastSync(msg.timestamp)

			this.room.broadcast(
				JSON.stringify({
					type: 'session_deleted',
					payload: { id, version: deleted.version },
					timestamp: Date.now(),
				}),
				[sender.id],
			)
		}

		sender.send(
			JSON.stringify({
				type: 'session_delete_ack',
				payload: { id },
			}),
		)
	}

	private async handleSyncRequest(msg: SyncMessage, sender: Party.Connection) {
		const { since } = msg.payload

		// Get all sessions modified since the given timestamp
		const allSessions = await this.getAllSessions()
		const changedSessions = Object.values(allSessions).filter((s) => s.updatedAt > since)

		sender.send(
			JSON.stringify({
				type: 'sync_response',
				payload: {
					sessions: changedSessions,
					serverTime: Date.now(),
				},
			}),
		)
	}

	// --- Helper Methods ---

	private async getAllSessions(): Promise<Record<string, StoredSession>> {
		const items = await this.room.storage.list<StoredSession>({ prefix: 'session:' })
		const sessions: Record<string, StoredSession> = {}

		for (const [key, value] of items) {
			const id = key.replace('session:', '')
			// Filter out tombstoned sessions older than 30 days
			if (!value.deletedAt || Date.now() - value.deletedAt < 30 * 24 * 60 * 60 * 1000) {
				sessions[id] = value
			}
		}

		return sessions
	}

	private async updateLastSync(timestamp: number) {
		await this.room.storage.put('lastSync', timestamp)
	}

	// --- HTTP API for initial sync / recovery ---

	static async onBeforeRequest(request: Party.Request, lobby: Party.Lobby) {
		// Same auth logic as WebSocket
		const token = request.headers.get('Authorization')?.replace('Bearer ', '')
		if (!token) {
			return new Response('Unauthorized', { status: 401 })
		}

		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
		)

		if (!response.ok) {
			return new Response('Unauthorized', { status: 401 })
		}

		return request
	}

	async onRequest(request: Party.Request) {
		if (request.method === 'GET') {
			const sessions = await this.getAllSessions()
			return new Response(JSON.stringify({ sessions }), {
				headers: { 'Content-Type': 'application/json' },
			})
		}

		return new Response('Method not allowed', { status: 405 })
	}
}
```

### 3. PartyKit Server - Live Tabs Party (Optional)

```typescript
// party/live-tabs.ts
import type * as Party from 'partykit/server'

interface DeviceTabs {
	deviceId: string
	deviceName: string
	tabs: {
		url: string
		title: string
		favIconUrl?: string
		windowId: number
		active: boolean
	}[]
	lastUpdate: number
}

export default class LiveTabsServer implements Party.Server {
	options: Party.ServerOptions = {
		hibernate: true,
	}

	deviceTabs: Map<string, DeviceTabs> = new Map()

	constructor(readonly room: Party.Room) {}

	static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
		// Same auth as sessions party
		const token = new URL(request.url).searchParams.get('token')
		if (!token) {
			return new Response('Unauthorized', { status: 401 })
		}

		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`,
		)

		if (!response.ok) {
			return new Response('Unauthorized', { status: 401 })
		}

		return request
	}

	async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
		const deviceId = new URL(ctx.request.url).searchParams.get('deviceId')
		const deviceName =
			new URL(ctx.request.url).searchParams.get('deviceName') || 'Unknown Device'

		connection.setState({ deviceId, deviceName })

		// Send current state of all devices
		connection.send(
			JSON.stringify({
				type: 'devices_state',
				payload: Object.fromEntries(this.deviceTabs),
			}),
		)
	}

	async onMessage(message: string, sender: Party.Connection) {
		const msg = JSON.parse(message)
		const state = sender.state as { deviceId: string; deviceName: string }

		if (msg.type === 'tabs_update') {
			const deviceTabs: DeviceTabs = {
				deviceId: state.deviceId,
				deviceName: state.deviceName,
				tabs: msg.payload.tabs,
				lastUpdate: Date.now(),
			}

			this.deviceTabs.set(state.deviceId, deviceTabs)

			// Broadcast to all other devices
			this.room.broadcast(
				JSON.stringify({
					type: 'device_tabs_updated',
					payload: deviceTabs,
				}),
				[sender.id],
			)
		}
	}

	async onClose(connection: Party.Connection) {
		const state = connection.state as { deviceId: string }
		if (state?.deviceId) {
			this.deviceTabs.delete(state.deviceId)

			this.room.broadcast(
				JSON.stringify({
					type: 'device_disconnected',
					payload: { deviceId: state.deviceId },
				}),
			)
		}
	}
}
```

### 4. Client-Side Sync Module

```typescript
// src/sync/SyncClient.ts
import PartySocket from 'partysocket'
import { v4 as uuidv4 } from 'uuid'
import { getToken, getCurrentUser } from './auth'

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'papaya-bar-sync.partykit.dev'

interface SyncClientOptions {
	onSessionsUpdated: (sessions: Map<string, StoredSession>) => void
	onConnectionChange: (connected: boolean) => void
	onConflict: (conflict: ConflictData) => void
	onError: (error: Error) => void
}

interface StoredSession {
	id: string
	data: SavedData
	version: number
	updatedAt: number
	createdAt: number
	deletedAt?: number
}

interface ConflictData {
	id: string
	serverVersion: StoredSession
	clientVersion: any
}

export class SyncClient {
	private socket: PartySocket | null = null
	private pendingOps: Map<string, { resolve: Function; reject: Function }> = new Map()
	private localSessions: Map<string, StoredSession> = new Map()
	private deviceId: string
	private reconnectAttempts = 0
	private maxReconnectAttempts = 5

	constructor(private options: SyncClientOptions) {
		// Generate or retrieve stable device ID
		this.deviceId = this.getDeviceId()
	}

	private getDeviceId(): string {
		let deviceId = localStorage.getItem('papaya:deviceId')
		if (!deviceId) {
			deviceId = uuidv4()
			localStorage.setItem('papaya:deviceId', deviceId)
		}
		return deviceId
	}

	async connect(): Promise<void> {
		const token = await getToken()
		const user = await getCurrentUser()

		if (!token || !user) {
			throw new Error('Not authenticated')
		}

		this.socket = new PartySocket({
			host: PARTYKIT_HOST,
			room: user.id, // Room ID = User ID for isolation
			party: 'main', // Sessions sync party
			query: async () => ({
				token: await getToken(),
				deviceId: this.deviceId,
			}),
		})

		this.socket.addEventListener('open', () => {
			this.reconnectAttempts = 0
			this.options.onConnectionChange(true)
		})

		this.socket.addEventListener('close', () => {
			this.options.onConnectionChange(false)
			this.handleReconnect()
		})

		this.socket.addEventListener('error', (e) => {
			this.options.onError(new Error('WebSocket error'))
		})

		this.socket.addEventListener('message', (event) => {
			this.handleMessage(JSON.parse(event.data))
		})
	}

	private handleReconnect() {
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++
			const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
			setTimeout(() => this.connect(), delay)
		}
	}

	private handleMessage(msg: any) {
		switch (msg.type) {
			case 'full_sync':
				this.handleFullSync(msg.payload)
				break

			case 'session_created':
			case 'session_updated':
				this.localSessions.set(msg.payload.id, msg.payload)
				this.options.onSessionsUpdated(this.localSessions)
				break

			case 'session_deleted':
				const existing = this.localSessions.get(msg.payload.id)
				if (existing) {
					existing.deletedAt = Date.now()
					this.localSessions.set(msg.payload.id, existing)
					this.options.onSessionsUpdated(this.localSessions)
				}
				break

			case 'conflict':
				this.options.onConflict(msg.payload)
				break

			case 'session_create_ack':
			case 'session_update_ack':
			case 'session_delete_ack':
				const pending = this.pendingOps.get(msg.payload.id)
				if (pending) {
					pending.resolve(msg.payload)
					this.pendingOps.delete(msg.payload.id)
				}
				break

			case 'error':
				const pendingError = this.pendingOps.get(msg.payload.id)
				if (pendingError) {
					pendingError.reject(new Error(msg.payload.message))
					this.pendingOps.delete(msg.payload.id)
				}
				break
		}
	}

	private handleFullSync(payload: { sessions: Record<string, StoredSession> }) {
		this.localSessions = new Map(Object.entries(payload.sessions))
		this.options.onSessionsUpdated(this.localSessions)
	}

	async createSession(data: SavedData): Promise<{ id: string; version: number }> {
		const id = uuidv4()

		return new Promise((resolve, reject) => {
			this.pendingOps.set(id, { resolve, reject })

			this.socket?.send(
				JSON.stringify({
					type: 'session_create',
					payload: { id, data },
					timestamp: Date.now(),
					deviceId: this.deviceId,
				}),
			)

			// Timeout after 10 seconds
			setTimeout(() => {
				if (this.pendingOps.has(id)) {
					this.pendingOps.delete(id)
					reject(new Error('Operation timed out'))
				}
			}, 10000)
		})
	}

	async updateSession(
		id: string,
		data: Partial<SavedData>,
		expectedVersion?: number,
	): Promise<{ version: number }> {
		return new Promise((resolve, reject) => {
			this.pendingOps.set(id, { resolve, reject })

			this.socket?.send(
				JSON.stringify({
					type: 'session_update',
					payload: { id, data, expectedVersion },
					timestamp: Date.now(),
					deviceId: this.deviceId,
				}),
			)

			setTimeout(() => {
				if (this.pendingOps.has(id)) {
					this.pendingOps.delete(id)
					reject(new Error('Operation timed out'))
				}
			}, 10000)
		})
	}

	async deleteSession(id: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.pendingOps.set(id, { resolve, reject })

			this.socket?.send(
				JSON.stringify({
					type: 'session_delete',
					payload: { id },
					timestamp: Date.now(),
					deviceId: this.deviceId,
				}),
			)

			setTimeout(() => {
				if (this.pendingOps.has(id)) {
					this.pendingOps.delete(id)
					reject(new Error('Operation timed out'))
				}
			}, 10000)
		})
	}

	disconnect() {
		this.socket?.close()
		this.socket = null
	}

	isConnected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN
	}
}
```

### 5. Vue Composable for Sync

```typescript
// src/hooks/useSyncedSessions.ts
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useStorage } from '@vueuse/core'
import { SyncClient } from '@/sync/SyncClient'
import { getCurrentUser, getToken } from '@/sync/auth'
import type { SavedData } from './useSessionsData'

interface SyncedSession {
	id: string
	data: SavedData
	version: number
	updatedAt: number
	createdAt: number
	deletedAt?: number
	syncStatus: 'synced' | 'pending' | 'error'
}

// Local cache for offline support
const localCache = useStorage<Record<string, SyncedSession>>('papaya:sessions:cache', {})
const pendingChanges = useStorage<
	Array<{
		type: 'create' | 'update' | 'delete'
		id: string
		data?: SavedData
		timestamp: number
	}>
>('papaya:sessions:pending', [])

export function useSyncedSessions() {
	const sessions = ref<Map<string, SyncedSession>>(new Map())
	const isConnected = ref(false)
	const isSyncing = ref(false)
	const syncError = ref<Error | null>(null)
	const isAuthenticated = ref(false)
	const user = ref<{ id: string; email: string; name: string } | null>(null)

	let syncClient: SyncClient | null = null

	// Initialize from cache
	const initFromCache = () => {
		const cached = localCache.value
		sessions.value = new Map(Object.entries(cached).filter(([_, s]) => !s.deletedAt))
	}

	// Sync client callbacks
	const handleSessionsUpdated = (serverSessions: Map<string, any>) => {
		sessions.value = new Map(
			[...serverSessions.entries()]
				.filter(([_, s]) => !s.deletedAt)
				.map(([id, s]) => [id, { ...s, syncStatus: 'synced' }]),
		)

		// Update cache
		localCache.value = Object.fromEntries(sessions.value)
	}

	const handleConnectionChange = (connected: boolean) => {
		isConnected.value = connected

		if (connected) {
			// Process pending changes
			processPendingChanges()
		}
	}

	const handleConflict = (conflict: any) => {
		// For now, server wins. Could implement UI for user choice.
		console.warn('Sync conflict detected, server version kept:', conflict)
		sessions.value.set(conflict.id, {
			...conflict.serverVersion,
			syncStatus: 'synced',
		})
	}

	const handleError = (error: Error) => {
		syncError.value = error
		console.error('Sync error:', error)
	}

	// Process offline changes
	const processPendingChanges = async () => {
		if (!syncClient || !isConnected.value) return

		isSyncing.value = true
		const pending = [...pendingChanges.value]

		for (const change of pending) {
			try {
				switch (change.type) {
					case 'create':
						await syncClient.createSession(change.data!)
						break
					case 'update':
						await syncClient.updateSession(change.id, change.data!)
						break
					case 'delete':
						await syncClient.deleteSession(change.id)
						break
				}

				// Remove processed change
				pendingChanges.value = pendingChanges.value.filter(
					(c) => c.id !== change.id || c.timestamp !== change.timestamp,
				)
			} catch (e) {
				console.error('Failed to process pending change:', e)
			}
		}

		isSyncing.value = false
	}

	// Public API
	const connect = async () => {
		const currentUser = await getCurrentUser()
		const token = await getToken()

		if (!currentUser || !token) {
			isAuthenticated.value = false
			return
		}

		user.value = currentUser
		isAuthenticated.value = true

		syncClient = new SyncClient({
			onSessionsUpdated: handleSessionsUpdated,
			onConnectionChange: handleConnectionChange,
			onConflict: handleConflict,
			onError: handleError,
		})

		await syncClient.connect()
	}

	const disconnect = () => {
		syncClient?.disconnect()
		syncClient = null
		isConnected.value = false
	}

	const createSession = async (data: SavedData): Promise<string> => {
		const tempId = crypto.randomUUID()

		// Optimistic update
		const tempSession: SyncedSession = {
			id: tempId,
			data,
			version: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			syncStatus: 'pending',
		}

		sessions.value.set(tempId, tempSession)
		localCache.value = Object.fromEntries(sessions.value)

		if (isConnected.value && syncClient) {
			try {
				const result = await syncClient.createSession(data)

				// Update with server-assigned values
				sessions.value.delete(tempId)
				sessions.value.set(result.id, {
					...tempSession,
					id: result.id,
					version: result.version,
					syncStatus: 'synced',
				})
				localCache.value = Object.fromEntries(sessions.value)

				return result.id
			} catch (e) {
				sessions.value.set(tempId, { ...tempSession, syncStatus: 'error' })
				throw e
			}
		} else {
			// Offline - queue for later
			pendingChanges.value.push({
				type: 'create',
				id: tempId,
				data,
				timestamp: Date.now(),
			})

			return tempId
		}
	}

	const updateSession = async (id: string, data: Partial<SavedData>) => {
		const existing = sessions.value.get(id)
		if (!existing) throw new Error('Session not found')

		// Optimistic update
		const updated: SyncedSession = {
			...existing,
			data: { ...existing.data, ...data },
			updatedAt: Date.now(),
			syncStatus: 'pending',
		}

		sessions.value.set(id, updated)
		localCache.value = Object.fromEntries(sessions.value)

		if (isConnected.value && syncClient) {
			try {
				const result = await syncClient.updateSession(id, data, existing.version)
				sessions.value.set(id, {
					...updated,
					version: result.version,
					syncStatus: 'synced',
				})
				localCache.value = Object.fromEntries(sessions.value)
			} catch (e) {
				sessions.value.set(id, { ...updated, syncStatus: 'error' })
				throw e
			}
		} else {
			pendingChanges.value.push({
				type: 'update',
				id,
				data: updated.data,
				timestamp: Date.now(),
			})
		}
	}

	const deleteSession = async (id: string) => {
		const existing = sessions.value.get(id)
		if (!existing) return

		// Optimistic delete
		sessions.value.delete(id)
		localCache.value = Object.fromEntries(sessions.value)

		if (isConnected.value && syncClient) {
			try {
				await syncClient.deleteSession(id)
			} catch (e) {
				// Restore on error
				sessions.value.set(id, existing)
				localCache.value = Object.fromEntries(sessions.value)
				throw e
			}
		} else {
			pendingChanges.value.push({
				type: 'delete',
				id,
				timestamp: Date.now(),
			})
		}
	}

	// Computed
	const sessionsList = computed(() =>
		[...sessions.value.values()]
			.filter((s) => !s.deletedAt)
			.sort((a, b) => b.updatedAt - a.updatedAt),
	)

	const hasPendingChanges = computed(() => pendingChanges.value.length > 0)

	// Lifecycle
	onMounted(() => {
		initFromCache()
	})

	onUnmounted(() => {
		disconnect()
	})

	return {
		// State
		sessions: sessionsList,
		isConnected,
		isSyncing,
		syncError,
		isAuthenticated,
		user,
		hasPendingChanges,

		// Actions
		connect,
		disconnect,
		createSession,
		updateSession,
		deleteSession,
	}
}
```

---

## Migration Strategy

### Phase 1: Add Sync Infrastructure (Non-Breaking)

1. Create PartyKit project alongside extension
2. Add authentication module
3. Create new `useSyncedSessions` hook
4. Keep existing `useSessionsData` working

### Phase 2: Data Migration

```typescript
// src/sync/migration.ts
import { useStorage } from '@vueuse/core'
import type { SavedData } from '@/hooks/useSessionsData'

interface MigrationStatus {
	migrated: boolean
	migratedAt?: number
	version: number
}

const migrationStatus = useStorage<MigrationStatus>('papaya:migration', {
	migrated: false,
	version: 0,
})

export async function migrateLocalToSync(syncClient: SyncClient) {
	if (migrationStatus.value.migrated) {
		return
	}

	// Read old localStorage sessions
	const oldSessions = useStorage('sessions:saved', new Map<string, SavedData>())

	// Convert date-based keys to UUIDs
	for (const [dateKey, data] of oldSessions.value.entries()) {
		try {
			await syncClient.createSession(data)
			console.log(`Migrated session: ${dateKey}`)
		} catch (e) {
			console.error(`Failed to migrate session ${dateKey}:`, e)
		}
	}

	migrationStatus.value = {
		migrated: true,
		migratedAt: Date.now(),
		version: 1,
	}
}
```

### Phase 3: UI Updates

1. Add Settings page section for sync
2. Add sign in/sign out buttons
3. Show sync status indicators
4. Show connected devices (optional)

---

## Conflict Resolution Strategy

### Last-Write-Wins (LWW)

Simple approach where the most recent update wins:

```typescript
function resolveConflict(
	serverVersion: StoredSession,
	clientVersion: StoredSession,
): StoredSession {
	return serverVersion.updatedAt > clientVersion.updatedAt ? serverVersion : clientVersion
}
```

### Merge Strategy (Recommended for Sessions)

For sessions, we can implement a smarter merge:

```typescript
function mergeSessionData(server: SavedData, client: SavedData): SavedData {
	return {
		title: client.title, // Prefer client edits for metadata
		description: client.description,
		// Merge tabs by stableId
		tabs: mergeTabs(server.tabs, client.tabs),
		groups: mergeGroups(server.groups, client.groups),
		windows: client.windows, // Use client's window layout
		displays: client.displays,
	}
}

function mergeTabs(serverTabs: SaveableTab[], clientTabs: SaveableTab[]): SaveableTab[] {
	const merged = new Map<string, SaveableTab>()

	// Add all server tabs
	serverTabs.forEach((t) => merged.set(t.stableId, t))

	// Override/add client tabs
	clientTabs.forEach((t) => merged.set(t.stableId, t))

	return [...merged.values()]
}
```

---

## Folder Structure

### With TinyBase (Recommended)

```
chonching-tabs-ext/
├── party/                          # PartyKit server code
│   ├── auth.ts                     # Email/password auth API
│   ├── sync.ts                     # TinyBase sync server
│   └── live-tabs.ts                # Optional live tabs party
├── src/
│   ├── sync/                       # Client-side sync code
│   │   ├── auth.ts                 # Auth client (email/password)
│   │   ├── store.ts                # TinyBase store setup
│   │   └── migration.ts            # Local → TinyBase migration
│   ├── hooks/
│   │   ├── useSessionsData.ts      # Existing (keep for local-only fallback)
│   │   ├── useTinyBaseStore.ts     # TinyBase reactive hook
│   │   └── useLiveTabs.ts          # Optional live tabs hook
│   └── ...
├── partykit.json                   # PartyKit configuration
└── ...
```

### Without TinyBase (Custom Sync)

```
chonching-tabs-ext/
├── party/                          # PartyKit server code
│   ├── auth.ts                     # Email/password auth API
│   ├── sessions.ts                 # Custom sessions sync party
│   ├── live-tabs.ts                # Optional live tabs party
│   └── types.ts                    # Shared types
├── src/
│   ├── sync/                       # Client-side sync code
│   │   ├── auth.ts                 # Auth client
│   │   ├── SyncClient.ts           # PartySocket wrapper
│   │   ├── migration.ts            # Local → cloud migration
│   │   └── types.ts                # Sync-related types
│   ├── hooks/
│   │   ├── useSessionsData.ts      # Existing (keep for local-only)
│   │   ├── useSyncedSessions.ts    # Synced sessions hook
│   │   └── useLiveTabs.ts          # Optional live tabs hook
│   └── ...
├── partykit.json                   # PartyKit configuration
└── ...
```

---

## Dependencies

### Extension (Client)

```bash
# TinyBase approach
pnpm add tinybase partysocket

# OR Custom sync approach
pnpm add partysocket uuid
pnpm add -D @types/uuid

# Both approaches need PartyKit for dev/deploy
pnpm add -D partykit
```

### PartyKit Server

```bash
# Add JWT library (works in Cloudflare Workers)
# This is automatically available in PartyKit
# @tsndr/cloudflare-worker-jwt
```

---

## Environment Variables

```bash
# .env.local (extension)
VITE_PARTYKIT_HOST=papaya-bar-sync.username.partykit.dev

# No secrets needed! Session tokens are stored in the database, not signed JWTs.
```

---

## Deployment

### PartyKit Configuration

```json
// partykit.json
{
	"name": "papaya-bar-sync",
	"main": "party/sync.ts",
	"parties": {
		"auth": "party/auth.ts",
		"tabs": "party/live-tabs.ts"
	}
}
```

### PartyKit Managed (Recommended to Start)

```bash
# Install PartyKit
pnpm add -D partykit

# Deploy (no secrets needed - sessions are database-backed!)
npx partykit deploy
```

### PartyKit Cloud-Prem (Own Cloudflare Account)

```bash
CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx npx partykit deploy --domain sync.papayabar.com
```

---

## Security Considerations

1. **Database-Backed Sessions**: Tokens are stored in database, not JWTs - immediately revocable
2. **Room Isolation**: Room ID = User ID ensures data isolation
3. **Password Hashing**: SHA-256 with random salt (consider argon2/scrypt for production)
4. **Rate Limiting**: Implement rate limiting on auth endpoints to prevent brute force
5. **Session Management**: Users can view and revoke active sessions from other devices
6. **Token Format**: 256-bit cryptographically random tokens (not guessable)
7. **HTTPS Only**: PartyKit enforces HTTPS in production
8. **CORS**: Configured in auth party for extension access
9. **Activity Tracking**: `lastActiveAt` updated on each verify call - can implement inactivity timeout

---

## Cost Estimation

### PartyKit Pricing (Managed)

- Free tier: Good for development
- Pay-as-you-go based on:
    - WebSocket connections (hibernation reduces this)
    - Storage usage
    - Compute time

### Self-Hosted (Cloudflare)

- Durable Objects: $0.15/million requests
- Storage: $0.20/GB stored per month
- WebSocket connections: Part of Workers pricing

**Hibernation Impact**: With hibernation enabled, you only pay for active processing, not idle connections. Critical for cost optimization.

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

- [ ] Set up PartyKit project structure
- [ ] Implement email/password auth party
- [ ] Set up TinyBase with MergeableStore
- [ ] Create TinyBase sync party with auth
- [ ] Add local persistence (localStorage)

### Phase 2: Integration (Week 2-3)

- [ ] Create `useTinyBaseStore` Vue hook
- [ ] Add auth UI (login/register modals)
- [ ] Add sync UI to Settings page
- [ ] Test multi-device sync

### Phase 3: Migration (Week 3-4)

- [ ] Build migration script (localStorage → TinyBase)
- [ ] Add migration UI/prompts on first sync
- [ ] Test data integrity

### Phase 4: Polish (Week 4+)

- [ ] Add sync status indicators in UI
- [ ] Add offline indicator
- [ ] Add connected devices view (optional)
- [ ] Performance optimization

---

## Open Questions / Future Considerations

1. **Encryption**: Should session data be E2E encrypted?
2. **Sharing**: Allow sharing sessions between users?
3. **Live Tabs**: Is real-time tab sync valuable or too noisy?
4. **Quota**: Should there be limits on sessions per user?
5. **Export/Import**: Maintain JSON export for backup?
6. **Password Reset**: Implement email-based password reset flow?
7. **Social Login**: Add Google/GitHub OAuth as additional option?
8. **Account Deletion**: Implement GDPR-compliant account/data deletion?

---

## Summary: Recommended Approach

| Component             | Recommendation               | Why                                                     |
| --------------------- | ---------------------------- | ------------------------------------------------------- |
| **Data Store**        | TinyBase MergeableStore      | Built-in CRDT, reactive, tiny bundle                    |
| **Sync Transport**    | PartyKit WebSocket           | Real-time, edge-deployed, hibernation                   |
| **Local Persistence** | TinyBase LocalPersister      | Offline support, auto-save                              |
| **Authentication**    | Email/Password (DB Sessions) | Revocable tokens, no secrets needed, session management |
| **Server**            | PartyKit Managed             | Easy deployment, free tier available                    |

This combination provides:

- **Offline-first**: Works without internet, syncs when connected
- **Real-time**: Instant sync across devices via WebSocket
- **Conflict-free**: TinyBase CRDT handles concurrent edits
- **Simple auth**: Email/password with database-backed sessions
- **Revocable sessions**: Can logout from all devices, view active sessions
- **No secrets**: No JWT secrets to manage or rotate
- **Low cost**: Hibernation + free tier = minimal costs
