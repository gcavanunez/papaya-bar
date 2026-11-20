/**
 * A small in-memory `chrome` for unit tests: windows, tabs, tab groups, displays,
 * storage.local, storage.session and runtime messages, with enough behavior to check
 * what restore and grouping code did to the browser. Install it with
 * `installFakeChrome()` in a test.
 */

interface FakeWindow {
	id: number
	left?: number
	top?: number
	width?: number
	height?: number
	focused: boolean
	tabIds: number[]
}

interface FakeTab {
	id: number
	windowId: number
	url: string
	title: string
	groupId: number
	active: boolean
	pinned: boolean
	discarded: boolean
	createdAt: number
}

interface FakeGroup {
	id: number
	windowId: number
	title: string
	color: string
	collapsed: boolean
}

export interface FakeChromeOptions {
	displays?: { left: number; top: number; width: number; height: number }[]
	/** URLs that chrome.tabs.create and chrome.windows.create refuse to open */
	blockedUrls?: string[]
	/**
	 * How long a new tab takes to commit its address. Until then `url` is empty (only
	 * `pendingUrl` is set), and unloading the tab loses its address, as in Chrome.
	 */
	commitDelayMs?: number
}

export function installFakeChrome(options: FakeChromeOptions = {}) {
	const displays = options.displays ?? [{ left: 0, top: 0, width: 1728, height: 1117 }]
	const blocked = new Set(options.blockedUrls ?? [])
	const commitDelay = options.commitDelayMs ?? 0
	const committed = (tab: FakeTab) => Date.now() - tab.createdAt >= commitDelay
	const windows = new Map<number, FakeWindow>()
	const tabs = new Map<number, FakeTab>()
	const groups = new Map<number, FakeGroup>()
	const storage = new Map<string, unknown>()
	/** storage.session: Chrome clears it when the browser restarts or the extension reloads */
	const sessionStorage = new Map<string, unknown>()
	type StorageListener = (
		changes: Record<string, chrome.storage.StorageChange>,
		area: string,
	) => void
	const storageListeners = new Set<StorageListener>()
	/** Like Chrome, listeners hear about a write after it lands, in every "document" */
	function emitStorage(changes: Record<string, chrome.storage.StorageChange>, area = 'local') {
		const copy = structuredClone(changes)
		setTimeout(() => storageListeners.forEach((listener) => listener(copy, area)), 0)
	}
	function storageArea(map: Map<string, unknown>, area: string) {
		return {
			async get(keys?: string | string[] | null) {
				const list = keys == null ? [...map.keys()] : Array.isArray(keys) ? keys : [keys]
				return Object.fromEntries(
					list.filter((k) => map.has(k)).map((k) => [k, structuredClone(map.get(k))]),
				)
			},
			async getKeys() {
				return [...map.keys()]
			},
			async set(items: Record<string, unknown>) {
				const changes: Record<string, chrome.storage.StorageChange> = {}
				for (const [k, v] of Object.entries(items)) {
					changes[k] = { oldValue: map.get(k), newValue: v }
					map.set(k, structuredClone(v))
				}
				emitStorage(changes, area)
			},
			async remove(keys: string | string[]) {
				const changes: Record<string, chrome.storage.StorageChange> = {}
				for (const k of Array.isArray(keys) ? keys : [keys]) {
					if (!map.has(k)) continue
					changes[k] = { oldValue: map.get(k) }
					map.delete(k)
				}
				if (Object.keys(changes).length) emitStorage(changes, area)
			},
		}
	}
	type MessageListener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	) => boolean | undefined | void
	const messageListeners = new Set<MessageListener>()
	/** Messages cross as JSON, as in Chrome: anything else is lost on the way */
	const overTheWire = <T>(value: T): T =>
		value === undefined ? value : JSON.parse(JSON.stringify(value))
	/**
	 * Like Chrome: delivered later, to every listener; the first answer wins; a listener
	 * that returns true answers later. No listener at all is an error; listeners that
	 * never answer resolve to undefined.
	 */
	function sendMessage(message: unknown, callback?: (response: unknown) => void) {
		const sent = overTheWire(message)
		const reply = new Promise<unknown>((resolve, reject) => {
			setTimeout(() => {
				if (!messageListeners.size) {
					reject(
						new Error('Could not establish connection. Receiving end does not exist.'),
					)
					return
				}
				let answered = false
				let waiting = false
				const sendResponse = (response?: unknown) => {
					if (answered) return
					answered = true
					resolve(overTheWire(response))
				}
				for (const listener of [...messageListeners]) {
					if (listener(sent, { id: api.runtime.id }, sendResponse) === true)
						waiting = true
				}
				if (!waiting && !answered) resolve(undefined)
			}, 0)
		})
		if (!callback) return reply
		void reply.then(callback, () => callback(undefined))
	}
	let nextId = 1
	const calls: { method: string; args: unknown }[] = []

	const tabView = (tab: FakeTab): chrome.tabs.Tab =>
		({
			...tab,
			url: committed(tab) ? tab.url : '',
			index: windows.get(tab.windowId)!.tabIds.indexOf(tab.id),
			status: 'loading',
			pendingUrl: tab.url,
			highlighted: tab.active,
			incognito: false,
			selected: tab.active,
			autoDiscardable: true,
			frozen: false,
		}) as unknown as chrome.tabs.Tab

	const windowView = (win: FakeWindow): chrome.windows.Window =>
		({
			id: win.id,
			left: win.left,
			top: win.top,
			width: win.width,
			height: win.height,
			focused: win.focused,
			tabs: win.tabIds.map((id) => tabView(tabs.get(id)!)),
		}) as chrome.windows.Window

	function checkUrl(url: string | undefined) {
		if (url && blocked.has(url)) throw new Error(`Cannot open ${url}`)
	}

	function addTab(windowId: number, url: string | undefined, index?: number, active = false) {
		const win = windows.get(windowId)
		if (!win) throw new Error(`No window with id: ${windowId}.`)
		const tab: FakeTab = {
			id: nextId++,
			windowId,
			url: url ?? 'chrome://newtab/',
			title: '',
			groupId: -1,
			active: false,
			pinned: false,
			discarded: false,
			createdAt: Date.now(),
		}
		tabs.set(tab.id, tab)
		const at =
			index == null || index < 0 ? win.tabIds.length : Math.min(index, win.tabIds.length)
		win.tabIds.splice(at, 0, tab.id)
		if (active || win.tabIds.length === 1) activate(tab.id)
		return tab
	}

	function activate(tabId: number) {
		const tab = tabs.get(tabId)!
		for (const id of windows.get(tab.windowId)!.tabIds) tabs.get(id)!.active = id === tabId
		// Like Chrome, showing an unloaded tab loads it
		tab.discarded = false
	}

	function removeTab(tabId: number) {
		const tab = tabs.get(tabId)
		if (!tab) return
		const win = windows.get(tab.windowId)!
		win.tabIds = win.tabIds.filter((id) => id !== tabId)
		tabs.delete(tabId)
		if (!win.tabIds.length) windows.delete(win.id)
		for (const group of groups.values()) {
			if (![...tabs.values()].some((t) => t.groupId === group.id)) groups.delete(group.id)
		}
	}

	const api = {
		runtime: {
			id: 'papaya-test',
			sendMessage,
			onMessage: {
				addListener: (listener: MessageListener) => messageListeners.add(listener),
				removeListener: (listener: MessageListener) => messageListeners.delete(listener),
			},
		},
		system: {
			display: {
				getInfo(callback: (info: unknown[]) => void) {
					callback(
						displays.map((bounds, i) => ({ id: String(i), bounds, workArea: bounds })),
					)
				},
			},
		},
		windows: {
			async create(props: chrome.windows.CreateData = {}) {
				calls.push({ method: 'windows.create', args: props })
				const url = Array.isArray(props.url) ? props.url[0] : props.url
				checkUrl(url)
				for (const win of windows.values()) win.focused = false
				const win: FakeWindow = {
					id: nextId++,
					left: props.left,
					top: props.top,
					width: props.width,
					height: props.height,
					focused: props.focused ?? true,
					tabIds: [],
				}
				windows.set(win.id, win)
				addTab(win.id, url, undefined, true)
				return windowView(win)
			},
			async getAll() {
				return [...windows.values()].map(windowView)
			},
			async getLastFocused() {
				const win =
					[...windows.values()].find((w) => w.focused) ?? [...windows.values()].at(-1)
				if (!win) throw new Error('No window')
				return windowView(win)
			},
			async get(id: number) {
				const win = windows.get(id)
				if (!win) throw new Error(`No window with id: ${id}.`)
				return windowView(win)
			},
			async update(id: number, props: chrome.windows.UpdateInfo) {
				const win = windows.get(id)!
				if (props.focused) for (const w of windows.values()) w.focused = w.id === id
				return windowView(win)
			},
		},
		tabs: {
			async create(props: chrome.tabs.CreateProperties) {
				calls.push({ method: 'tabs.create', args: props })
				checkUrl(props.url)
				const windowId = props.windowId ?? [...windows.values()].find((w) => w.focused)!.id
				const tab = addTab(windowId, props.url, props.index, props.active ?? true)
				if (props.pinned) tab.pinned = true
				return tabView(tab)
			},
			async query(info: chrome.tabs.QueryInfo = {}) {
				return [...windows.values()]
					.flatMap((w) => w.tabIds.map((id) => tabs.get(id)!))
					.filter(
						(t) =>
							(info.windowId == null || t.windowId === info.windowId) &&
							(info.groupId == null || t.groupId === info.groupId) &&
							(info.active == null || t.active === info.active) &&
							(info.pinned == null || t.pinned === info.pinned),
					)
					.map(tabView)
			},
			async get(id: number) {
				const tab = tabs.get(id)
				if (!tab) throw new Error(`No tab with id: ${id}.`)
				return tabView(tab)
			},
			async update(id: number, props: chrome.tabs.UpdateProperties) {
				const tab = tabs.get(id)
				if (!tab) throw new Error(`No tab with id: ${id}.`)
				if (props.active) activate(id)
				if (props.pinned != null) tab.pinned = props.pinned
				return tabView(tab)
			},
			async remove(ids: number | number[]) {
				for (const id of Array.isArray(ids) ? ids : [ids]) removeTab(id)
			},
			async discard(id: number) {
				const tab = tabs.get(id)!
				if (tab.active) throw new Error('Cannot discard the active tab')
				// Unloaded before committing, a tab forgets its address
				if (!committed(tab)) tab.url = ''
				tab.discarded = true
				return tabView(tab)
			},
			async group({
				tabIds,
				groupId,
				createProperties,
			}: {
				tabIds: number | number[]
				groupId?: number
				createProperties?: { windowId?: number }
			}) {
				const ids = Array.isArray(tabIds) ? tabIds : [tabIds]
				calls.push({
					method: 'tabs.group',
					args: { tabIds: ids, groupId, createProperties },
				})
				const first = tabs.get(ids[0])
				if (!first) throw new Error(`No tab with id: ${ids[0]}.`)
				const windowId = createProperties?.windowId ?? first.windowId
				if (ids.some((id) => tabs.get(id)?.windowId !== windowId)) {
					throw new Error('Tabs must be in the same window')
				}
				const id = groupId ?? nextId++
				if (!groups.has(id)) {
					groups.set(id, { id, windowId, title: '', color: 'grey', collapsed: false })
				}
				for (const tabId of ids) tabs.get(tabId)!.groupId = id
				return id
			},
			async ungroup(ids: number | number[]) {
				for (const id of Array.isArray(ids) ? ids : [ids]) tabs.get(id)!.groupId = -1
			},
		},
		tabGroups: {
			async query(info: { windowId?: number; collapsed?: boolean } = {}) {
				return [...groups.values()].filter(
					(g) =>
						(info.windowId == null || g.windowId === info.windowId) &&
						(info.collapsed == null || g.collapsed === info.collapsed),
				)
			},
			async get(id: number) {
				const group = groups.get(id)
				if (!group) throw new Error(`No group with id: ${id}.`)
				return { ...group }
			},
			async update(id: number, props: Partial<FakeGroup>) {
				const group = groups.get(id)
				if (!group) throw new Error(`No group with id: ${id}.`)
				Object.assign(group, props)
				return group
			},
		},
		storage: {
			local: storageArea(storage, 'local'),
			session: storageArea(sessionStorage, 'session'),
			onChanged: {
				addListener: (listener: StorageListener) => storageListeners.add(listener),
				removeListener: (listener: StorageListener) => storageListeners.delete(listener),
			},
		},
	}

	Object.assign(globalThis, { chrome: api })

	/** The background worker stops: everything it listened to goes with it */
	function stopWorker() {
		storageListeners.clear()
		messageListeners.clear()
	}

	return {
		chrome: api,
		calls,
		storage,
		sessionStorage,
		stopWorker,
		/** The extension reloads: a new worker, and storage.session is cleared; tabs stay */
		reloadExtension() {
			stopWorker()
			sessionStorage.clear()
		},
		/**
		 * Chrome quits and starts again without restoring anything: no windows, a new
		 * worker, and only storage.local kept
		 */
		restartBrowser() {
			stopWorker()
			sessionStorage.clear()
			windows.clear()
			tabs.clear()
			groups.clear()
		},
		/** Close a window and its tabs, as the person would */
		async closeWindow(id: number) {
			for (const tabId of windows.get(id)?.tabIds ?? []) removeTab(tabId)
		},
		/** Each window's tabs in strip order */
		snapshot() {
			return [...windows.values()].map((win) => ({
				id: win.id,
				bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
				tabs: win.tabIds.map((id) => {
					const tab = tabs.get(id)!
					const group = groups.get(tab.groupId)
					return {
						url: tab.url,
						active: tab.active,
						group: group ? `${group.title}/${group.color}/${group.collapsed}` : null,
					}
				}),
			}))
		},
		/** Addresses of the tabs Chrome holds unloaded */
		discardedUrls() {
			return [...tabs.values()].filter((t) => t.discarded).map((t) => t.url)
		},
		/** Open a window with tabs, as if the user already had them */
		async seedWindow(urls: string[]) {
			const win = await api.windows.create({ url: urls[0] })
			for (const url of urls.slice(1))
				await api.tabs.create({ windowId: win.id, url, active: false })
			return win.id!
		},
	}
}
