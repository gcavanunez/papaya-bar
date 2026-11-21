/**
 * Content script (isolated world) — matches the working layout in
 * src/content/. Handles clipboard/screenshot messages AND injects the global
 * ⌥K command palette.
 *
 * It runs at document_start so its key listener comes before any the page adds: while
 * the palette is open, the page sees none of your keys (see onKey).
 */
// Zero imports on purpose — keeps the dynamically-imported content chunk
// self-contained and trivial to load.
console.warn('[papaya] content script loaded @', location.href)

function copyToClipboard(text: string): void {
	navigator.clipboard?.writeText(text).catch(() => {})
}
async function copyImageToClipboard(imageUrl: string): Promise<void> {
	const res = await fetch(imageUrl)
	const blob = await res.blob()
	await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

// ==================== Clipboard / screenshot bridge ====================
chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
	if (request.message === 'copyText') {
		copyToClipboard(request.textToCopy)
		sendResponse({ success: true })
	}
	if (request.name === 'stream' && request.dataURI) {
		copyImageToClipboard(request.dataURI)
			.then(() => sendResponse({ success: true }))
			.catch((err) => {
				alert('Could not take screenshot')
				sendResponse({ success: false, message: err })
			})
		return true
	}
})

// ==================== Global ⌥K palette ====================
installPalette()

function installPalette(): void {
	const w = window as unknown as { __papayaPaletteInstalled?: boolean; __papayaPalette?: () => void }
	if (w.__papayaPaletteInstalled) return
	if (window.top !== window.self) return
	w.__papayaPaletteInstalled = true

	interface Model {
		groups: { id: number; title: string; color: string; tabCount: number }[]
		/** Groups stashed in the open session */
		stashed: { id: string; name: string; color: string; tabCount: number }[]
		migrated: boolean
		sessions: {
			id: string
			name: string
			color: string
			tabCount: number
			open: boolean
			home: boolean
		}[]
		openTabs: { id: number; title: string; url: string; favIconUrl: string }[]
	}
	interface SavedTab {
		title: string
		url: string
		favIconUrl: string
		sessionName: string
	}
	interface Item {
		label: string
		sub: string
		icon: string
		/** `shift`: Shift was held, which swaps groups */
		run: (shift?: boolean) => void
	}

	const COLORS: Record<string, string> = {
		grey: '#94a3b8',
		blue: '#3b82f6',
		red: '#ef4444',
		yellow: '#eab308',
		green: '#22c55e',
		pink: '#ec4899',
		purple: '#a855f7',
		cyan: '#06b6d4',
		orange: '#f97316',
	}
	const STYLE =
		':host{all:initial}' +
		// A modal <dialog> covering the viewport (its browser styles undone)
		'.overlay{position:fixed;inset:0;z-index:2147483647;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;box-sizing:border-box;overflow:hidden;color:inherit;display:flex;justify-content:center;align-items:flex-start;padding:14vh 0 0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}' +
		'.overlay:not([open]){display:none}' +
		'.overlay::backdrop{background:transparent}' +
		'.box{width:90%;max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35)}' +
		'.search{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #eef2f7}' +
		'.search input{flex:1;border:0;outline:0;font-size:15px;color:#0f172a;background:transparent}' +
		'.list{max-height:50vh;overflow-y:auto;padding:6px}' +
		'.row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer}' +
		'.row.active{background:#f1f5f9}' +
		'.dot{width:9px;height:9px;border-radius:50%;flex:none}' +
		'.fav{width:16px;height:16px;border-radius:3px;flex:none}' +
		'.label{flex:1;font-size:14px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
		'.tag{font-size:11px;color:#64748b;background:#f1f5f9;padding:2px 6px;border-radius:4px;flex:none}' +
		'.empty{padding:28px;text-align:center;color:#94a3b8;font-size:14px}' +
		'.hint{font-size:11px;color:#94a3b8}' +
		'@media (prefers-color-scheme:dark){.box{background:#111}.search{border-color:#333}.search input{color:#fff}.row.active{background:#222}.label{color:#fff}.tag{background:#222;color:#999}}'

	const CONTAINED_EVENTS = [
		'beforeinput',
		'input',
		'compositionstart',
		'compositionupdate',
		'compositionend',
		'paste',
		'copy',
		'cut',
		'focusin',
		'focusout',
	]

	let host: HTMLDivElement | null = null
	let root: ShadowRoot | null = null
	let input: HTMLInputElement | null = null
	/** What had focus before the palette opened; it gets it back on close */
	let returnFocus: HTMLElement | null = null
	/** Keys the palette took (by code) whose keyup hasn't come yet */
	const ownKeys = new Set<string>()
	let isOpen = false
	let model: Model | null = null
	let items: Item[] = []
	let activeIndex = 0
	let query = ''
	let saved: SavedTab[] = []
	let savedTimer: ReturnType<typeof setTimeout> | undefined
	let savedSeq = 0

	const send = <T = Model>(message: Record<string, unknown>): Promise<T> =>
		new Promise((resolve) => chrome.runtime.sendMessage(message, (res) => resolve(res as T)))

	const matches = (t: string) => (t || '').toLowerCase().includes(query.trim().toLowerCase())
	const esc = (s: string) =>
		String(s).replace(
			/[&<>"']/g,
			(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
		)
	const favIcon = (url: string) =>
		url ? `<img class="fav" src="${esc(url)}" alt="" />` : '<span class="dot" style="background:#cbd5e1"></span>'

	function ensureDom() {
		if (host) return
		host = document.createElement('div')
		root = host.attachShadow({ mode: 'open' })
		const style = document.createElement('style')
		style.textContent = STYLE
		root.appendChild(style)
		// Text, clipboard and focus events from the input stop at the palette's edge, so the
		// page doesn't take them for its own. (Keys are stopped earlier, on window.)
		for (const type of CONTAINED_EVENTS) host.addEventListener(type, (e) => e.stopPropagation())
		document.documentElement.appendChild(host)
	}

	function act(message: Record<string, unknown>) {
		void send(message)
		close()
	}

	function buildItems(): Item[] {
		if (!model) return []
		const out: Item[] = []
		const q = query.trim()
		const cmd = '<span class="dot" style="background:#94a3b8"></span>'

		;(model.groups || [])
			.filter((g) => matches(g.title || 'Unnamed group'))
			.slice(0, 8)
			.forEach((g) =>
				out.push({
					label: g.title || 'Unnamed group',
					sub: `group · ${g.tabCount} tabs`,
					icon: `<span class="dot" style="background:${COLORS[g.color] || COLORS.grey}"></span>`,
					run: (shift) =>
						act({ type: 'palette.focusGroup', groupId: g.id, swap: !!shift }),
				}),
			)
		;(model.stashed || [])
			.filter((g) => matches(g.name))
			.slice(0, 8)
			.forEach((g) =>
				out.push({
					label: g.name,
					sub: `stashed · ${g.tabCount} tabs`,
					icon: `<span class="dot" style="opacity:.6;background:${COLORS[g.color] || COLORS.grey}"></span>`,
					run: (shift) =>
						act({ type: 'palette.openStashed', stashId: g.id, swap: !!shift }),
				}),
			)

		const open = model.sessions.find((x) => x.open)
		const cmds: Item[] = []
		if (open && !open.home) {
			cmds.push(
				{
					label: `Save a checkpoint of “${open.name}”`,
					sub: 'command',
					icon: cmd,
					run: () => act({ type: 'palette.saveCheckpoint' }),
				},
				{
					label: `Put “${open.name}” away`,
					sub: 'command',
					icon: cmd,
					run: () => act({ type: 'palette.putAway' }),
				},
			)
		}
		if (model.migrated) {
			cmds.push({
				label: 'Save open tabs as a new session…',
				sub: 'command',
				icon: cmd,
				run: () => {
					const name = window.prompt('Name this session')
					if (name && name.trim()) act({ type: 'palette.saveAs', name: name.trim() })
				},
			})
		}
		cmds.forEach((c) => matches(c.label) && out.push(c))

		model.sessions
			.filter((x) => !x.open && matches(x.name))
			.slice(0, 6)
			.forEach((x) =>
				out.push({
					label: x.name,
					sub: `session · ${x.tabCount} tabs`,
					icon: `<span class="dot" style="background:${x.home ? '#cbd5e1' : COLORS[x.color] || COLORS.grey}"></span>`,
					run: () => act({ type: 'palette.switch', sessionId: x.id }),
				}),
			)

		if (q) {
			model.openTabs
				.filter((t) => matches(t.title) || matches(t.url))
				.slice(0, 6)
				.forEach((t) =>
					out.push({
						label: t.title || t.url,
						sub: 'open tab',
						icon: favIcon(t.favIconUrl),
						run: () => act({ type: 'palette.jumpTab', tabId: t.id }),
					}),
				)
			saved.forEach((t) =>
				out.push({
					label: t.title || t.url,
					sub: t.sessionName,
					icon: favIcon(t.favIconUrl),
					run: () => act({ type: 'palette.openUrl', url: t.url }),
				}),
			)
		}
		return out.slice(0, 20)
	}

	function render() {
		if (!root) return
		items = buildItems()
		if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1)
		const rows = items.length
			? items
					.map(
						(it, i) =>
							`<div class="row ${i === activeIndex ? 'active' : ''}" data-i="${i}">${it.icon}<span class="label">${esc(it.label)}</span><span class="tag">${esc(it.sub)}</span></div>`,
					)
					.join('')
			: '<div class="empty">No matches</div>'
		const list = root.querySelector('.list')
		if (!list) return
		list.innerHTML = rows
		root.querySelectorAll<HTMLElement>('.row').forEach((el) =>
			el.addEventListener('click', (e) => {
				const i = Number(el.dataset.i)
				items[i]?.run(e.shiftKey)
			}),
		)
	}

	function open() {
		ensureDom()
		if (!root) return
		const focused = document.activeElement
		returnFocus = focused instanceof HTMLElement && focused !== host ? focused : null
		isOpen = true
		query = ''
		saved = []
		activeIndex = 0
		removeOverlays()
		const overlay = document.createElement('dialog')
		overlay.className = 'overlay'
		overlay.innerHTML =
			'<div class="box"><div class="search"><span class="hint">⌥K</span><input type="text" placeholder="Go to a group, switch session, jump to a tab…" /></div><div class="list"></div></div>'
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close()
		})
		overlay.addEventListener('cancel', (e) => {
			e.preventDefault()
			close()
		})
		root.appendChild(overlay)
		// As a modal it sits in the top layer, above the page's own dialogs and overlays (and
		// a fullscreen video), and the page is inert under it: nothing there can take focus,
		// so a page's focus trap can't pull your typing back into its search box
		try {
			overlay.showModal()
		} catch {
			overlay.setAttribute('open', '')
		}
		const field = root.querySelector<HTMLInputElement>('.search input')!
		input = field
		field.addEventListener('input', () => {
			query = field.value
			activeIndex = 0
			render()
			// Tabs saved in sessions come from the background, a moment after typing stops
			clearTimeout(savedTimer)
			const seq = ++savedSeq
			savedTimer = setTimeout(() => {
				void send<SavedTab[]>({ type: 'palette.searchSaved', query }).then((found) => {
					if (seq !== savedSeq || !isOpen) return
					saved = Array.isArray(found) ? found : []
					render()
				})
			}, 150)
		})
		field.focus()
		render()
		void send({ type: 'palette.getModel' }).then((m) => {
			model = m
			render()
		})
	}

	function removeOverlays() {
		root?.querySelectorAll<HTMLDialogElement>('.overlay').forEach((overlay) => {
			if (overlay.open) overlay.close()
			overlay.remove()
		})
	}

	function close() {
		isOpen = false
		model = null
		input = null
		removeOverlays()
		// The page carries on where it was
		const back = returnFocus
		returnFocus = null
		if (back?.isConnected) back.focus({ preventScroll: true })
	}

	/**
	 * Every key event on the page passes here first: this listener is on window, in the
	 * capture phase, and was added before any of the page's (document_start). While the
	 * palette is open it stops them all, so no site shortcut runs (YouTube's "k", GitHub's
	 * "/" pulling focus into its own search box). Stopping an event doesn't stop its
	 * typing, so the palette's input still fills.
	 */
	function onKey(e: KeyboardEvent) {
		// The keyup of a key the palette took is its too, even once it has closed (Escape)
		if (e.type === 'keyup' && ownKeys.delete(e.code)) {
			e.stopImmediatePropagation()
			return
		}
		if (e.type === 'keydown' && e.altKey && (e.key === 'k' || e.code === 'KeyK')) {
			e.preventDefault()
			e.stopImmediatePropagation()
			ownKeys.add(e.code)
			if (isOpen) close()
			else open()
			return
		}
		if (!isOpen) {
			// Pressed again: whatever we kept of its last press is stale (its keyup went elsewhere)
			if (e.type === 'keydown') ownKeys.delete(e.code)
			return
		}
		e.stopImmediatePropagation()
		if (e.type === 'keydown') {
			ownKeys.add(e.code)
			onPaletteKey(e)
		}
	}

	function onPaletteKey(e: KeyboardEvent) {
		// If the page took focus back, this key types into the palette all the same: a key
		// lands wherever focus is once its keydown is done
		if (input && root?.activeElement !== input) input.focus()
		// Enter and the arrows belong to an IME while it composes
		if (e.isComposing) return
		const step = (by: number) => {
			e.preventDefault()
			activeIndex = Math.min(Math.max(activeIndex + by, 0), Math.max(items.length - 1, 0))
			render()
		}
		if (e.key === 'Escape') {
			e.preventDefault()
			close()
		} else if (e.key === 'ArrowDown') step(1)
		else if (e.key === 'ArrowUp') step(-1)
		// Tab would move focus out into the page; it moves through the list instead
		else if (e.key === 'Tab') step(e.shiftKey ? -1 : 1)
		else if (e.key === 'Enter') {
			e.preventDefault()
			items[activeIndex]?.run(e.shiftKey)
		}
	}

	for (const type of ['keydown', 'keypress', 'keyup'] as const) {
		window.addEventListener(type, onKey, true)
	}

	w.__papayaPalette = open
	console.warn('[papaya] global palette ready — press Alt/⌥+K')
}
