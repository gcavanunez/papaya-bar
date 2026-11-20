/**
 * Small pieces of state kept outside the library index, so they never sync: which
 * session this browser has open, for one.
 *
 * Every extension page and the background worker keep a cached copy, so reads are
 * synchronous; the copy follows chrome.storage.onChanged. Writes update the cache at
 * once and are stored in order, each merged onto what is stored at that moment, so two
 * contexts writing different fields don't undo each other.
 */

export interface StateStore<T extends object> {
	/** The cached copy */
	get(): T
	/** What is stored right now, for decisions the cache may be too stale for */
	read(): Promise<T>
	/** Change some fields; resolves once stored */
	set(patch: Partial<T>): Promise<void>
	/** Bring the cached copy up to what is stored, without waiting to hear of it */
	refresh(): Promise<T>
	/** Hear every change, from this context or another; returns a function to stop */
	subscribe(listener: (state: T) => void): () => void
}

/** Which session this browser's windows belong to; '' means Home */
export interface DeviceState {
	openSessionId: string
}

export const DEVICE_KEY = 'library:device'
export const DEVICE_DEFAULTS: DeviceState = { openSessionId: '' }

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void

/** Stored fields of the right type over the defaults; anything else is ignored */
function normalize<T extends object>(defaults: T, raw: unknown): T {
	const result = { ...defaults }
	if (raw && typeof raw === 'object') {
		for (const key of Object.keys(defaults) as (keyof T)[]) {
			const value = (raw as T)[key]
			if (typeof value === typeof defaults[key]) result[key] = value
		}
	}
	return result
}

const same = <T extends object>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)

/** State kept in memory only, for tests and temporary libraries */
export function memoryState<T extends object>(defaults: T): StateStore<T> {
	let state = { ...defaults }
	const listeners = new Set<(state: T) => void>()
	return {
		get: () => state,
		read: async () => state,
		async set(patch) {
			const next = { ...state, ...patch }
			if (same(next, state)) return
			state = next
			for (const listener of listeners) listener(state)
		},
		refresh: async () => state,
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

export interface ChromeStateOptions {
	/** For pages: only the background worker writes the library's state */
	readOnly?: boolean
}

/** State kept under one chrome.storage key, loaded before it is returned */
export async function chromeState<T extends object>(
	area: 'local' | 'session',
	key: string,
	defaults: T,
	options: ChromeStateOptions = {},
): Promise<StateStore<T>> {
	let state = { ...defaults }
	const listeners = new Set<(state: T) => void>()
	const update = (next: T) => {
		if (same(next, state)) return
		state = next
		for (const listener of listeners) listener(state)
	}
	const read = async () => normalize(defaults, (await chrome.storage[area].get(key))[key])

	let heard = false
	const onChanged: StorageListener = (changes, changedArea) => {
		if (changedArea !== area || !(key in changes)) return
		heard = true
		update(normalize(defaults, changes[key].newValue))
	}
	chrome.storage.onChanged.addListener(onChanged)
	const loaded = await read()
	if (!heard) update(loaded)

	let writing: Promise<void> = Promise.resolve()
	return {
		get: () => state,
		read,
		set(patch) {
			if (options.readOnly) {
				return Promise.reject(
					new Error(`A page cannot change ${key}; the background worker writes it`),
				)
			}
			update({ ...state, ...patch })
			const write = writing.then(async () => {
				await chrome.storage[area].set({ [key]: { ...(await read()), ...patch } })
			})
			writing = write.catch((error) => console.warn('[papaya] could not save', key, error))
			return write
		},
		async refresh() {
			update(await read())
			return state
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

export const chromeDevice = (options?: ChromeStateOptions) =>
	chromeState('local', DEVICE_KEY, DEVICE_DEFAULTS, options)
export const memoryDevice = () => memoryState(DEVICE_DEFAULTS)
