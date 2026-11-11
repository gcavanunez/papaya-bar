import { AUTO_PARK_DAYS, isParkable } from './src/lib/liveTabs'
import { cycleGroup, focusGroup, listOpenGroups } from './src/lib/tabGroups'
import { getLibrary } from './src/lib/library/runtime'
import { parkTabs, putAway, saveOpenAs, saveVersion, switchTo } from './src/lib/library/actions'
import { HOME_ID, getOpenSessionId, isMigrated, listSessions } from './src/lib/library/store'

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
// When enabled in settings, periodically move tabs untouched for N days into the
// Parked session and close them.

const PARK_ALARM = 'papaya-auto-park'

chrome.alarms.create(PARK_ALARM, { periodInMinutes: 30 })

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== PARK_ALARM) return

	const { 'papaya:autoPark': cfg } = await chrome.storage.local.get('papaya:autoPark')
	if (!cfg?.enabled) return

	// Nothing parks until saved sessions and contexts have moved into the library
	const lib = await getLibrary()
	if (!isMigrated(lib)) return

	const days = cfg.days ?? AUTO_PARK_DAYS
	const tabs = await chrome.tabs.query({})
	await parkTabs(lib, tabs.filter((t) => isParkable(t, days)))
})

// ==================== Website palette (⌥K) ====================
// The content-script palette can't reach the library, so it asks here. The library
// is shared with every extension page through chrome.storage.

async function paletteGetModel() {
	const lib = await getLibrary()
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
	return { groups, migrated, sessions, openTabs }
}

/** Tabs saved in closed sessions that match a search (contents load once, then cache) */
async function paletteSearchSaved(query) {
	const q = (query || '').trim().toLowerCase()
	if (q.length < 2) return []
	const lib = await getLibrary()
	const heads = listSessions(lib).filter((s) => s.status === 'closed' && s.headVersionId)
	const data = await lib.blobs.getMany(heads.map((s) => s.headVersionId))
	const found = []
	for (const session of heads) {
		for (const tab of data.get(session.headVersionId)?.tabs ?? []) {
			if (!`${tab.title} ${tab.url}`.toLowerCase().includes(q)) continue
			found.push({
				title: tab.title,
				url: tab.url,
				favIconUrl: tab.favIconUrl,
				sessionName: session.name,
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

async function handlePaletteMessage(message) {
	switch (message.type) {
		case 'palette.getModel':
			return paletteGetModel()
		case 'palette.searchSaved':
			return paletteSearchSaved(message.query)
		case 'palette.switch':
			await switchTo(await getLibrary(), message.sessionId)
			return { ok: true }
		case 'palette.saveVersion':
			await saveVersion(await getLibrary())
			return { ok: true }
		case 'palette.saveAs':
			await saveOpenAs(await getLibrary(), message.name)
			return { ok: true }
		case 'palette.putAway':
			await putAway(await getLibrary())
			return { ok: true }
		case 'palette.jumpTab':
			return paletteJumpTab(message.tabId)
		case 'palette.focusGroup':
			await focusGroup(message.groupId)
			return { ok: true }
		case 'palette.openUrl':
			await chrome.tabs.create({ url: message.url })
			return { ok: true }
		default:
			return { ok: false }
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message.type !== 'string' || !message.type.startsWith('palette.')) {
		return
	}
	handlePaletteMessage(message)
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
