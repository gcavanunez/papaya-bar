import { ref, watch } from 'vue'
import { format, isValid, parse } from 'date-fns'
import { Tab, Group, SaveableTab } from '@/types'
import { createSession as tinyBaseCreateSession, isStoreInitialized } from '@/sync/store'
import { getHostname } from '@/lib/format'
import { restoreSnapshot } from '@/lib/restore'

type ChromeTab = chrome.tabs.Tab
export const asyncGetTab = (tabId: number) =>
	new Promise<ChromeTab>((resolve) => {
		chrome.tabs.get(tabId, (tab) => resolve(tab))
	})
export type SavedSession = SaveableTab
export type SavedWindow = {
	width?: number
	left?: number
	height?: number
	top?: number
	id?: number
}
export type SavedDisplay = {
	height: number
	left: number
	top: number
	width: number
}
export type SavedData = {
	title: string
	description: string
	tabs: SaveableTab[]
	groups: Group[]
	windows: SavedWindow[]
	displays: SavedDisplay[]
}

// ==================== Sessions persistence (chrome.storage.local) ====================
// Moved off localStorage (which caps at ~5MB and isn't covered by
// unlimitedStorage) to chrome.storage.local, which IS unlimited. Heavy users
// with many saved sessions no longer hit QuotaExceededError.

const SESSIONS_KEY = 'sessions:saved'
const SESSION_KEY_FORMAT = 'hh:mm aaa MM/dd/yyyy'
const state = ref(new Map<string, SavedData>())

/** Sessions are keyed by the time they were saved */
export const sessionDate = (key: string): Date => {
	const parsed = parse(key, SESSION_KEY_FORMAT, new Date())
	return isValid(parsed) ? parsed : new Date(key)
}

/** The session's own title, or the sites it mostly contains */
export const sessionTitle = (data: Pick<SavedData, 'title' | 'tabs'>): string => {
	if (data.title?.trim()) return data.title.trim()
	const counts = new Map<string, number>()
	for (const tab of data.tabs) {
		const host = getHostname(tab.url)
		if (host) counts.set(host, (counts.get(host) ?? 0) + 1)
	}
	const hosts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([host]) => host)
	if (!hosts.length) return 'Untitled session'
	const shown = hosts.slice(0, 2).join(', ')
	return hosts.length > 2 ? `${shown} +${hosts.length - 2} more` : shown
}

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local
let suppressPersist = false

async function loadSessionsState(): Promise<void> {
	if (!hasChromeStorage) return
	try {
		const result = await chrome.storage.local.get(SESSIONS_KEY)
		const stored = result[SESSIONS_KEY] as [string, SavedData][] | undefined
		if (Array.isArray(stored)) {
			suppressPersist = true
			state.value = new Map(stored)
			return
		}
		// One-time migration from the old localStorage Map (reclaims quota).
		const legacy = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSIONS_KEY) : null
		if (legacy) {
			state.value = new Map(JSON.parse(legacy) as [string, SavedData][])
			await persistSessionsState()
			localStorage.removeItem(SESSIONS_KEY)
			console.log('[migration] Moved saved sessions from localStorage to chrome.storage.local')
		}
	} catch (e) {
		console.error('Failed to load saved sessions:', e)
	}
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
async function persistSessionsState(): Promise<void> {
	if (!hasChromeStorage) return
	try {
		// Deep-clone to PLAIN data — passing Vue reactive proxies to chrome.storage
		// makes its structured clone turn arrays into objects ({0:…,1:…}).
		const plain = JSON.parse(JSON.stringify([...state.value.entries()]))
		await chrome.storage.local.set({ [SESSIONS_KEY]: plain })
	} catch (e) {
		console.error('Failed to save sessions:', e)
	}
}

watch(
	state,
	() => {
		if (suppressPersist) {
			suppressPersist = false
			return
		}
		if (persistTimer) clearTimeout(persistTimer)
		persistTimer = setTimeout(persistSessionsState, 300)
	},
	{ deep: true },
)

void loadSessionsState()

export const useSessionsData = () => {
	const storeSession = async (tabs: Tab[]) => {
		const toStore: SavedSession[] = tabs.map((tab) => {
			return {
				id: tab.id,
				active: tab.active,
				url: tab.url,
				title: tab.title,
				favIconUrl: tab.favIconUrl,
				stableId: tab.stableId,
				windowId: tab.windowId,
				groupId: tab.groupId,
			}
		})
		let displays: SavedDisplay[] = []
		chrome.system.display.getInfo((display) => {
			// NOTE: Get current display size
			// const { width, height } = display[0].bounds
			// console.log({ display:display.map(row=>row.) })
			// displays.push(display)

			displays = display.map(({ bounds: { height, left, top, width } }) => ({
				height,
				left,
				top,
				width,
			}))

			// chrome.windows.create({
			// 	url: 'https://google.com',
			// 	type: 'popup',
			// 	width,
			// 	height,
			// })
		})
		const windows = await chrome.windows.getAll()
		const storedWindows = windows.map((queriedWindow) => {
			const { width, left, height, top, id } = queriedWindow
			return {
				width,
				left,
				height,
				top,
				id,
			}
		})
		const groups = await new Promise<Group[]>((resolve) => {
			chrome.tabGroups.query({}, (group) => resolve(group))
		})

		const relvantGroups = new Set<number>()

		toStore.forEach((row) => {
			if (row.groupId) {
				relvantGroups.add(row.groupId)
			}
		})
		const description = groups
			.filter((row) => relvantGroups.has(row.id))
			.map((row) => row.title)
			.join(', ')
		// groups.map(({color,id,windowId,title,collapsed})=>{return{color,}})
		state.value.set(format(new Date(), SESSION_KEY_FORMAT), {
			tabs: toStore,
			windows: storedWindows,
			groups: groups,
			displays,
			description: '',
			title: description,
		})

		// Bridge: also write to TinyBase for sync
		if (isStoreInitialized()) {
			try {
				tinyBaseCreateSession({
					title: description,
					description: '',
					tabs: toStore,
					groups: groups,
					windows: storedWindows,
				})
			} catch (e) {
				console.error('[sync bridge] Failed to write to TinyBase:', e)
			}
		}
	}
	/** Reopen a saved session in new windows (see lib/restore) */
	const openAll = async (data: SavedData) => {
		const { failed } = await restoreSnapshot(data)
		if (failed.length) console.warn('[papaya] could not reopen', failed)
	}
	const removeSavedSession = (key: string) => {
		state.value.delete(key)
	}
	const downloadSavedSession = (key: string, session: SavedData) => {
		const json = JSON.stringify(session)

		const a = document.createElement('a')
		a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
		a.download = `papaya-session-${key.replace(/[^\w]+/g, '-')}.json`
		a.click()
		a.remove()
	}
	/** Add a session previously exported with downloadSavedSession */
	const importSession = (data: Partial<SavedData>) => {
		if (!Array.isArray(data.tabs)) {
			throw new Error('That file doesn’t look like a saved session')
		}
		state.value.set(format(new Date(), SESSION_KEY_FORMAT), {
			title: data.title ?? '',
			description: data.description ?? '',
			tabs: data.tabs,
			groups: data.groups ?? [],
			windows: data.windows ?? [],
			displays: data.displays ?? [],
		})
	}
	const findByUid = (uid: string) => {
		return state.value.get(uid)
	}
	const saveByUid = (uid: string, newData: Partial<SavedData>) => {
		const session = state.value.get(uid)
		if (session) {
			state.value.set(uid, { ...session, ...newData })
		}
	}
	return {
		state,
		findByUid,
		saveByUid,
		storeSession,
		openAll,
		removeSavedSession,
		downloadSavedSession,
		importSession,
	}
}
