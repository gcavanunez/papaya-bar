import { cycleGroup, focusGroup, listOpenGroups } from './src/lib/tabGroups'
import {
	HOME_ID,
	getOpenSessionId,
	isMigrated,
	listSessions,
	listStashed,
} from './src/lib/library/store'
import { createAutosaver } from './src/lib/library/autosave'
import { createLibraryWriter } from './src/lib/library/writer'

// The only writer of the sessions library; pages send it library.* messages
const library = createLibraryWriter()
chrome.runtime.onMessage.addListener(library.onMessage)

// Autosave: the open session saves itself as its tabs change (src/lib/library/autosave.ts)
const autosave = createAutosaver(library)
const changed = () => autosave.changed()
chrome.tabs.onCreated.addListener(changed)
chrome.tabs.onRemoved.addListener(changed)
chrome.tabs.onMoved.addListener(changed)
chrome.tabs.onAttached.addListener(changed)
chrome.tabs.onDetached.addListener(changed)
chrome.tabs.onReplaced.addListener(changed)
chrome.tabs.onUpdated.addListener((_tabId, change) => autosave.tabUpdated(change))
chrome.tabGroups.onCreated.addListener(changed)
chrome.tabGroups.onUpdated.addListener(changed)
chrome.tabGroups.onMoved.addListener(changed)
chrome.tabGroups.onRemoved.addListener(changed)
chrome.windows.onCreated.addListener(changed)
chrome.windows.onRemoved.addListener(changed)
// Decide whether the open windows are the open session's without waiting for a change
autosave.tick().catch((error) => console.warn('[papaya] autosave', error))

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

// Auto-park was removed; clear its old setting on update
chrome.runtime.onInstalled.addListener(() => {
	void chrome.storage.local.remove('papaya:autoPark')
})

// ==================== Website palette (⌥K) ====================
// The content-script palette can't reach the library, so it asks here. What it changes
// runs on the library's queue, like a page's command.

async function paletteGetModel() {
	const lib = await library.library()
	const tabs = await chrome.tabs.query({})
	const extPrefix = 'chrome-extension://' + chrome.runtime.id
	const openTabs = tabs
		.filter((t) => !(t.url || '').startsWith(extPrefix))
		.map((t) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl }))
	const groups = (await listOpenGroups()).map((g) => ({
		id: g.id,
		title: g.title,
		color: g.color,
		tabCount: g.tabIds.length,
	}))
	const migrated = isMigrated(lib)
	const openSessionId = getOpenSessionId(lib)
	const sessions = migrated
		? listSessions(lib)
				.filter((s) => s.status !== 'archived')
				.map((s) => ({
					id: s.id,
					name: s.name,
					color: s.color,
					tabCount: s.tabCount,
					open: s.id === openSessionId,
					home: s.id === HOME_ID,
				}))
		: []
	// Groups stashed in the open session
	const stashed = migrated
		? listStashed(lib, openSessionId || HOME_ID).map((g) => ({
				id: g.id,
				name: g.name,
				color: g.color,
				tabCount: g.tabCount,
			}))
		: []
	return { groups, stashed, migrated, sessions, openTabs }
}

/**
 * Tabs saved in stashed groups and closed sessions that match a search (contents load
 * once, then cache)
 */
async function paletteSearchSaved(query) {
	const q = (query || '').trim().toLowerCase()
	if (q.length < 2) return []
	const lib = await library.library()
	const sessions = listSessions(lib)
	const sessionName = new Map(sessions.map((s) => [s.id, s.name]))
	const sources = [
		...listStashed(lib).map((g) => ({
			id: g.id,
			label: `${g.name} · ${sessionName.get(g.sessionId) ?? 'session'}`,
		})),
		...sessions
			.filter((s) => s.status === 'closed' && s.contentId)
			.map((s) => ({ id: s.contentId, label: s.name })),
	]
	const data = await lib.blobs.getMany(sources.map((source) => source.id))
	const found = []
	for (const source of sources) {
		for (const tab of data.get(source.id)?.tabs ?? []) {
			if (!`${tab.title} ${tab.url}`.toLowerCase().includes(q)) continue
			found.push({
				title: tab.title,
				url: tab.url,
				favIconUrl: tab.favIconUrl,
				sessionName: source.label,
			})
			if (found.length >= 6) return found
		}
	}
	return found
}

async function paletteJumpTab(tabId) {
	const tab = await chrome.tabs.get(tabId)
	if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true })
	await chrome.tabs.update(tabId, { active: true })
	return { ok: true }
}

async function handlePaletteMessage(message, sender) {
	switch (message.type) {
		case 'palette.getModel':
			return paletteGetModel()
		case 'palette.searchSaved':
			return paletteSearchSaved(message.query)
		case 'palette.switch':
			await library.run('switchTo', { sessionId: message.sessionId })
			return { ok: true }
		case 'palette.saveCheckpoint':
			await library.run('saveCheckpoint')
			return { ok: true }
		case 'palette.saveAs':
			await library.run('saveOpenAs', { name: message.name })
			return { ok: true }
		case 'palette.putAway':
			await library.run('putAway')
			return { ok: true }
		case 'palette.jumpTab':
			return paletteJumpTab(message.tabId)
		case 'palette.focusGroup':
			// Shift swaps: the group you're in is stashed
			if (message.swap) await library.run('swapToGroup', { groupId: message.groupId })
			else await focusGroup(message.groupId)
			return { ok: true }
		case 'palette.openStashed': {
			const args = { stashId: message.stashId, windowId: sender?.tab?.windowId }
			await library.run(message.swap ? 'swapToStashed' : 'openStashed', args)
			return { ok: true }
		}
		case 'palette.openUrl':
			await chrome.tabs.create({ url: message.url })
			return { ok: true }
		default:
			return { ok: false }
	}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (!message || typeof message.type !== 'string' || !message.type.startsWith('palette.')) {
		return
	}
	handlePaletteMessage(message, sender)
		.then(sendResponse)
		.catch((error) => {
			console.error('[papaya] palette', message.type, error)
			sendResponse({ ok: false, error: String(error) })
		})
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
		case 'next-group':
			void cycleGroup(1, openedTab?.windowId)
			break
		case 'previous-group':
			void cycleGroup(-1, openedTab?.windowId)
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
