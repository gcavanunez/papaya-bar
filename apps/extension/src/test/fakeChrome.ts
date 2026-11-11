/**
 * A small in-memory `chrome` for unit tests: windows, tabs, tab groups, displays
 * and storage.local, with enough behavior to check what restore and grouping code
 * did to the browser. Install it with `installFakeChrome()` in a test.
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
}

export function installFakeChrome(options: FakeChromeOptions = {}) {
	const displays = options.displays ?? [{ left: 0, top: 0, width: 1728, height: 1117 }]
	const blocked = new Set(options.blockedUrls ?? [])
	const windows = new Map<number, FakeWindow>()
	const tabs = new Map<number, FakeTab>()
	const groups = new Map<number, FakeGroup>()
	const storage = new Map<string, unknown>()
	type StorageListener = (
		changes: Record<string, chrome.storage.StorageChange>,
		area: string,
	) => void
	const storageListeners = new Set<StorageListener>()
	/** Like Chrome, listeners hear about a write after it lands, in every "document" */
	function emitStorage(changes: Record<string, chrome.storage.StorageChange>) {
		const copy = structuredClone(changes)
		setTimeout(() => storageListeners.forEach((listener) => listener(copy, 'local')), 0)
	}
	let nextId = 1
	const calls: { method: string; args: unknown }[] = []

	const tabView = (tab: FakeTab): chrome.tabs.Tab =>
		({
			...tab,
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
		runtime: { id: 'papaya-test' },
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
			async query(info: { windowId?: number } = {}) {
				return [...groups.values()].filter(
					(g) => info.windowId == null || g.windowId === info.windowId,
				)
			},
			async update(id: number, props: Partial<FakeGroup>) {
				const group = groups.get(id)
				if (!group) throw new Error(`No group with id: ${id}.`)
				Object.assign(group, props)
				return group
			},
		},
		storage: {
			local: {
				async get(keys?: string | string[] | null) {
					const list =
						keys == null ? [...storage.keys()] : Array.isArray(keys) ? keys : [keys]
					return Object.fromEntries(
						list
							.filter((k) => storage.has(k))
							.map((k) => [k, structuredClone(storage.get(k))]),
					)
				},
				async set(items: Record<string, unknown>) {
					const changes: Record<string, chrome.storage.StorageChange> = {}
					for (const [k, v] of Object.entries(items)) {
						changes[k] = { oldValue: storage.get(k), newValue: v }
						storage.set(k, structuredClone(v))
					}
					emitStorage(changes)
				},
				async remove(keys: string | string[]) {
					const changes: Record<string, chrome.storage.StorageChange> = {}
					for (const k of Array.isArray(keys) ? keys : [keys]) {
						if (!storage.has(k)) continue
						changes[k] = { oldValue: storage.get(k) }
						storage.delete(k)
					}
					if (Object.keys(changes).length) emitStorage(changes)
				},
			},
			onChanged: {
				addListener: (listener: StorageListener) => storageListeners.add(listener),
				removeListener: (listener: StorageListener) => storageListeners.delete(listener),
			},
		},
	}

	Object.assign(globalThis, { chrome: api })

	return {
		chrome: api,
		calls,
		storage,
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
		/** Open a window with tabs, as if the user already had them */
		async seedWindow(urls: string[]) {
			const win = await api.windows.create({ url: urls[0] })
			for (const url of urls.slice(1))
				await api.tabs.create({ windowId: win.id, url, active: false })
			return win.id!
		},
	}
}
