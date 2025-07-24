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
			pendingPopupData = {
				type: 'copy-data-to-clipboard',
				dataURI,
			}
			// await chrome.storage.local.set({
			// 	type: 'copy-data-to-clipboard',
			// 	dataURI,
			// })
			chrome.action.openPopup({
				data,
			})
			// .then(() => {
			// const poptab = res.tabs[0]
			// setTimeout(() => {
			// 	chrome.tabs.sendMessage(
			// 		poptab.id,
			// 		{ name: 'stream', dataURI },
			// 		(_response) => {},
			// 	)
			// }, 500)
			// })
			// chrome.windows
			// 	.create({
			// 		url: chrome.runtime.getURL('index.html#/util-screenshot'),
			// 		type: 'popup',
			// 		top: 0,
			// 		left: 0,
			// 		height: 100,
			// 		width: 200,
			// 		focused: true,
			// 	})
			// 	.then((res) => {
			// 		const poptab = res.tabs[0]
			// 		setTimeout(() => {
			// 			chrome.tabs.sendMessage(
			// 				poptab.id,
			// 				{ name: 'stream', dataURI },
			// 				(_response) => {},
			// 			)
			// 		}, 500)
			// 	})
		})
	})
}

chrome.commands.onCommand.addListener((command, _openedTab) => {
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
