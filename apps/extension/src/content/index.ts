/**
 * Content script (isolated world) — matches the working layout in
 * src/content/. Handles clipboard/screenshot messages AND injects the global
 * ⌥K command palette.
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
		activeContextId: string
		contexts: { id: string; name: string; color: string; tabCount: number }[]
		savedTabs: { key: string; title: string; url: string; favIconUrl: string; contextName: string }[]
		openTabs: { id: number; title: string; url: string; favIconUrl: string }[]
	}
	interface Item {
		label: string
		sub: string
		icon: string
		run: () => void
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
		'.overlay{position:fixed;inset:0;z-index:2147483647;display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;background:rgba(15,23,42,.45);backdrop-filter:blur(2px);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}' +
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

	let host: HTMLDivElement | null = null
	let root: ShadowRoot | null = null
	let isOpen = false
	let model: Model | null = null
	let items: Item[] = []
	let activeIndex = 0
	let query = ''

	const send = (message: Record<string, unknown>): Promise<Model> =>
		new Promise((resolve) => chrome.runtime.sendMessage(message, (res) => resolve(res as Model)))

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
					run: () => act({ type: 'palette.focusGroup', groupId: g.id }),
				}),
			)

		const cmds: Item[] = []
		if (model.activeContextId)
			cmds.push({ label: 'Stash current context & clear', sub: 'command', icon: cmd, run: () => act({ type: 'palette.stash' }) })
		cmds.push({
			label: 'Save current tabs as context…',
			sub: 'command',
			icon: cmd,
			run: () => {
				const name = window.prompt('Name this context')
				if (name && name.trim()) act({ type: 'palette.createFromLive', name: name.trim() })
			},
		})
		cmds.forEach((c) => matches(c.label) && out.push(c))

		model.contexts
			.filter((c) => c.id !== model!.activeContextId && matches(c.name))
			.slice(0, 6)
			.forEach((c) =>
				out.push({
					label: c.name,
					sub: `${c.tabCount} tabs`,
					icon: `<span class="dot" style="background:${COLORS[c.color] || COLORS.grey}"></span>`,
					run: () => act({ type: 'palette.resume', contextId: c.id }),
				}),
			)

		if (q) {
			model.openTabs
				.filter((t) => matches(t.title) || matches(t.url))
				.slice(0, 6)
				.forEach((t) =>
					out.push({ label: t.title || t.url, sub: 'open tab', icon: favIcon(t.favIconUrl), run: () => act({ type: 'palette.jumpTab', tabId: t.id }) }),
				)
			model.savedTabs
				.filter((t) => matches(t.title) || matches(t.url))
				.slice(0, 6)
				.forEach((t) =>
					out.push({ label: t.title || t.url, sub: t.contextName, icon: favIcon(t.favIconUrl), run: () => act({ type: 'palette.openUrl', url: t.url }) }),
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
			el.addEventListener('click', () => {
				const i = Number(el.dataset.i)
				items[i]?.run()
			}),
		)
	}

	function open() {
		ensureDom()
		if (!root) return
		isOpen = true
		query = ''
		activeIndex = 0
		root.querySelectorAll('.overlay').forEach((n) => n.remove())
		const overlay = document.createElement('div')
		overlay.className = 'overlay'
		overlay.innerHTML =
			'<div class="box"><div class="search"><span class="hint">⌥K</span><input type="text" placeholder="Go to a group, swap context, jump to a tab…" /></div><div class="list"></div></div>'
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close()
		})
		root.appendChild(overlay)
		const input = root.querySelector<HTMLInputElement>('.search input')!
		input.addEventListener('input', () => {
			query = input.value
			activeIndex = 0
			render()
		})
		input.focus()
		render()
		void send({ type: 'palette.getModel' }).then((m) => {
			model = m
			render()
		})
	}

	function close() {
		isOpen = false
		model = null
		root?.querySelectorAll('.overlay').forEach((n) => n.remove())
	}

	window.addEventListener(
		'keydown',
		(e: KeyboardEvent) => {
			if (e.altKey && (e.key === 'k' || e.code === 'KeyK')) {
				e.preventDefault()
				e.stopPropagation()
				isOpen ? close() : open()
				return
			}
			if (!isOpen) return
			if (e.key === 'Escape') {
				e.preventDefault()
				close()
			} else if (e.key === 'ArrowDown') {
				e.preventDefault()
				activeIndex = Math.min(activeIndex + 1, items.length - 1)
				render()
			} else if (e.key === 'ArrowUp') {
				e.preventDefault()
				activeIndex = Math.max(activeIndex - 1, 0)
				render()
			} else if (e.key === 'Enter') {
				e.preventDefault()
				items[activeIndex]?.run()
			}
		},
		true,
	)

	w.__papayaPalette = open
	console.warn('[papaya] global palette ready — press Alt/⌥+K')
}
