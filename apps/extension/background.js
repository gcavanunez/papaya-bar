import { captureLiveData, getCloseableTabIds, restoreContext } from './src/lib/swapEngine'

// Get the current tab
const getCurrentTab = async () => {
	const queryOptions = { active: true, currentWindow: true }
	const [tab] = await chrome.tabs.query(queryOptions)
	return tab
}
let pendingPopupData = null
// Debounced badge update to avoid excessive API calls
let badgeUpdateTimeout = null

async function updateBadget() {
	const tabs = await chrome.tabs.query({})
	const count = tabs.length

	chrome.action.setBadgeTextColor({ color: '#ffffff' })
	if (count > 20) {
		chrome.action.setBadgeText({ text: `${count}` })
		chrome.action.setBadgeBackgroundColor({ color: '#dc2626' })
		return
	}

	if (count > 10) {
		chrome.action.setBadgeText({ text: `${count}` })
		chrome.action.setBadgeBackgroundColor({ color: '#ca8a04' })
		return
	}

	chrome.action.setBadgeBackgroundColor({ color: '#16a34a' })
	chrome.action.setBadgeText({ text: ' ' })
}

function debouncedUpdateBadge() {
	if (badgeUpdateTimeout) {
		clearTimeout(badgeUpdateTimeout)
	}
	badgeUpdateTimeout = setTimeout(updateBadget, 100)
}

chrome.tabs.onCreated.addListener(debouncedUpdateBadge)
chrome.tabs.onRemoved.addListener(debouncedUpdateBadge)

// ==================== Auto-park stale tabs (opt-in) ====================
// When enabled in settings, periodically queue tabs untouched for N days and
// close them. An open extension page drains the queue into the "Parked" context
// (service workers can't touch the localStorage-backed TinyBase store directly).

const PARK_ALARM = 'papaya-auto-park'

chrome.alarms.create(PARK_ALARM, { periodInMinutes: 30 })

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== PARK_ALARM) return

	const { 'papaya:autoPark': cfg } = await chrome.storage.local.get('papaya:autoPark')
	if (!cfg?.enabled) return

	const days = cfg.days ?? 7
	const threshold = Date.now() - days * 24 * 60 * 60 * 1000
	const extPrefix = 'chrome-extension://' + chrome.runtime.id

	const tabs = await chrome.tabs.query({})
	const stale = tabs.filter(
		(t) =>
			t.id != null &&
			!t.active &&
			!t.pinned &&
			!(t.url || '').startsWith(extPrefix) &&
			(t.lastAccessed ?? Date.now()) < threshold,
	)
	if (!stale.length) return

	const { 'papaya:parkQueue': existing } = await chrome.storage.local.get('papaya:parkQueue')
	const queue = Array.isArray(existing) ? existing : []
	stale.forEach((t) => queue.push({ url: t.url, title: t.title, favIconUrl: t.favIconUrl }))

	await chrome.storage.local.set({ 'papaya:parkQueue': queue })
	await chrome.tabs.remove(stale.map((t) => t.id))
})

// ==================== Global palette router ====================
// Serves the content-script palette: reads the contexts read-model (mirror),
// runs swaps via the shared swapEngine, and queues store mutations for any open
// extension page to reconcile into TinyBase.

const MIRROR_KEY = 'papaya:mirror'
const STORE_OPS_KEY = 'papaya:storeOps'

async function getMirror() {
	const s = await chrome.storage.local.get(MIRROR_KEY)
	return s[MIRROR_KEY] || { activeContextId: '', contexts: [], savedTabs: [] }
}

async function enqueueStoreOp(op) {
	const s = await chrome.storage.local.get(STORE_OPS_KEY)
	const ops = Array.isArray(s[STORE_OPS_KEY]) ? s[STORE_OPS_KEY] : []
	ops.push(op)
	await chrome.storage.local.set({ [STORE_OPS_KEY]: ops })
}

// Update the mirror's active pointer and (optionally) refresh a context's restore
// payload, so rapid back-to-back swaps stay correct even with no page open.
async function updateMirror(activeContextId, freshenContextId, capture) {
	const m = await getMirror()
	m.activeContextId = activeContextId
	if (freshenContextId && capture) {
		const ctx = (m.contexts || []).find((c) => c.id === freshenContextId)
		if (ctx) ctx.restore = { tabs: capture.tabs, windows: capture.windows, groups: capture.groups }
	}
	await chrome.storage.local.set({ [MIRROR_KEY]: m })
}

function paletteShortTime() {
	return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function paletteGetModel() {
	const mirror = await getMirror()
	const tabs = await chrome.tabs.query({})
	const extPrefix = 'chrome-extension://' + chrome.runtime.id
	const openTabs = tabs
		.filter((t) => !(t.url || '').startsWith(extPrefix))
		.map((t) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl }))
	return {
		activeContextId: mirror.activeContextId,
		contexts: (mirror.contexts || []).map((c) => ({
			id: c.id,
			name: c.name,
			color: c.color,
			tabCount: c.tabCount,
		})),
		savedTabs: mirror.savedTabs || [],
		openTabs,
	}
}

async function paletteResume(contextId) {
	const mirror = await getMirror()
	const target = (mirror.contexts || []).find((c) => c.id === contextId)
	if (!target) return { ok: false }

	const prev = mirror.activeContextId
	const closeIds = await getCloseableTabIds()
	const capture = await captureLiveData()

	if (prev) {
		await enqueueStoreOp({ type: 'setHead', contextId: prev, capture })
	} else if (capture.tabs.length) {
		await enqueueStoreOp({ type: 'create', name: `Unsorted · ${paletteShortTime()}`, capture })
	}

	await restoreContext(target.restore)
	await enqueueStoreOp({ type: 'setActive', contextId })
	await updateMirror(contextId, prev, capture)
	if (closeIds.length) await chrome.tabs.remove(closeIds)
	return { ok: true }
}

async function paletteStash() {
	const mirror = await getMirror()
	const prev = mirror.activeContextId
	if (!prev) return { ok: false }

	const closeIds = await getCloseableTabIds()
	const capture = await captureLiveData()
	await enqueueStoreOp({ type: 'setHead', contextId: prev, capture })
	await enqueueStoreOp({ type: 'setActive', contextId: '' })
	await updateMirror('', prev, capture)
	if (closeIds.length) await chrome.tabs.remove(closeIds)
	return { ok: true }
}

async function paletteCreateFromLive(name) {
	const capture = await captureLiveData()
	await enqueueStoreOp({ type: 'create', name, capture, activate: true })
	return { ok: true }
}

async function paletteJumpTab(tabId) {
	const tab = await chrome.tabs.get(tabId)
	if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true })
	await chrome.tabs.update(tabId, { active: true })
	return { ok: true }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message.type !== 'string' || !message.type.startsWith('palette.')) {
		return
	}
	;(async () => {
		switch (message.type) {
			case 'palette.getModel':
				sendResponse(await paletteGetModel())
				break
			case 'palette.resume':
				sendResponse(await paletteResume(message.contextId))
				break
			case 'palette.stash':
				sendResponse(await paletteStash())
				break
			case 'palette.createFromLive':
				sendResponse(await paletteCreateFromLive(message.name))
				break
			case 'palette.jumpTab':
				sendResponse(await paletteJumpTab(message.tabId))
				break
			case 'palette.openUrl':
				await chrome.tabs.create({ url: message.url })
				sendResponse({ ok: true })
				break
			default:
				sendResponse({ ok: false })
		}
	})()
	return true // keep the message channel open for the async response
})

// Command handlers
function handleOpenPage() {
	const url = 'chrome-extension://' + chrome.runtime.id + '/index.html'
	chrome.tabs.query({ url }, function (tabs) {
		if (tabs.length && tabs[0].id) {
			chrome.windows.update(tabs[0].windowId, { focused: true })
			chrome.tabs.update(tabs[0].id, { active: true })
		} else {
			chrome.tabs.create({ url })
		}
	})
}

function handleCopyLink() {
	// chrome.action.openPopup()
	chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
		const tab = tabs[0]
		const text = `${tab.title}\n${tab.url}`
		chrome.tabs.sendMessage(
			tab.id,
			{
				message: 'copyText',
				textToCopy: text,
			},
			function (_response) {},
		)
	})
}

function handleScreenshotArea() {
	getCurrentTab().then((tab) => {
		chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataURI) => {
			// Stash the capture; the popup pulls it via the 'popup-ready'
			// message on mount, copies it to the clipboard, and plays the
			// "Copied!" animation.
			pendingPopupData = {
				type: 'copy-data-to-clipboard',
				dataURI,
			}
			chrome.action.openPopup({ windowId: tab.windowId }).catch((err) => {
				// openPopup can fail (Chrome < 127, window not focused, …).
				// Fall back to copying via the content script so the
				// screenshot still lands on the clipboard.
				console.warn('openPopup failed, falling back to content-script copy', err)
				pendingPopupData = null
				chrome.tabs.sendMessage(tab.id, { name: 'stream', dataURI }, (_response) => {})
			})
		})
	})
}

function handleOpenPanel(tab) {
	// Must run within the user gesture, so call open() synchronously with the
	// window id the command fired in.
	if (chrome.sidePanel && tab?.windowId != null) {
		chrome.sidePanel.open({ windowId: tab.windowId })
	}
}

chrome.commands.onCommand.addListener((command, openedTab) => {
	switch (command) {
		case 'open-page':
			handleOpenPage()
			break
		case 'copy-link':
			handleCopyLink()
			break
		case 'screenshot-area':
			handleScreenshotArea()
			break
		case 'open-panel':
			handleOpenPanel(openedTab)
			break
	}
})

chrome.runtime.onMessage.addListener((message, _sender, senderResponse) => {
	if (message?.name === 'download' && message.url) {
		chrome.downloads.download(
			{
				filename: 'screenshot.png',
				url: message.url,
			},
			(_downloadId) => {
				senderResponse({ success: true })
			},
		)

		return true
	}

	if (message.type === 'popup-ready') {
		if (pendingPopupData) {
			senderResponse(pendingPopupData)
			pendingPopupData = null
		}
	}

	if (message == 'screenshot-area') {
		getCurrentTab().then((tab) => {
			chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataURI) => {
				chrome.windows
					.create({
						url: chrome.runtime.getURL('index.html#/util-screenshot'),
						type: 'popup',
						top: 0,
						left: 0,
						height: 100,
						width: 200,
						focused: true,
					})
					.then((res) => {
						const poptab = res.tabs[0]
						setTimeout(() => {
							chrome.tabs.sendMessage(
								poptab.id,
								{ name: 'stream', dataURI },
								(response) => console.log(response),
							)
						}, 500)
					})
					.then(() => {
						senderResponse({ success: true })
					})
			})
		})
	}
})

let creating // A global promise to avoid concurrency issues
async function setupOffscreenDocument(path) {
	// Check all windows controlled by the service worker to see if one
	// of them is the offscreen document with the given path
	const offscreenUrl = chrome.runtime.getURL(path)
	const existingContexts = await chrome.runtime.getContexts({
		contextTypes: ['OFFSCREEN_DOCUMENT'],
		documentUrls: [offscreenUrl],
	})

	if (existingContexts.length > 0) {
		return
	}

	// create offscreen document
	if (creating) {
		await creating
	} else {
		creating = chrome.offscreen.createDocument({
			url: path,
			reasons: ['CLIPBOARD'],
			justification: 'reason for needing the document',
		})
		await creating
		creating = null
	}
}

// https://github.com/GoogleChrome/chrome-extensions-samples/blob/main/functional-samples/cookbook.offscreen-clipboard-write/manifest.json
async function _addToClipboard(value) {
	await setupOffscreenDocument('offscreen.html')

	// Now that we have an offscreen document, we can dispatch the
	// message.
	chrome.runtime.sendMessage({
		type: 'copy-data-to-clipboard',
		target: 'offscreen-doc',
		data: value,
	})
}

// Solution 2 – Once extension service workers can use the Clipboard API,
// replace the offscreen document based implementation with something like this.
async function _addToClipboardV2(value) {
	navigator.clipboard.writeText(value)
}
