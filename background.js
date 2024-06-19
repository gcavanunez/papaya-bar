// Get the current tab
const getCurrentTab = async () => {
	const queryOptions = { active: true, currentWindow: true }
	const [tab] = await chrome.tabs.query(queryOptions)
	return tab
}
chrome.history.onVisited.addListener(function (historyItem) {
	console.log(historyItem)
	console.log(historyItem.url)
	chrome.tabs.query({ url: historyItem.url }, function (tab) {
		console.log('tab', tab)
	})
})
chrome.commands.onCommand.addListener((command, openedTab) => {
	console.log(`Command "${command}" triggered`)
	if (command == 'open-page') {
		// chrome.tabs.create({
		// 	url: 'chrome-extension://' + chrome.runtime.id + '/index.html',
		// })
		let url = 'chrome-extension://' + chrome.runtime.id + '/index.html'
		chrome.tabs.query({ url }, function (tabs) {
			if (tabs.length) {
				if (tabs[0].id) {
					chrome.windows.update(tabs[0].windowId, { focused: true })
					chrome.tabs.update(tabs[0].id, { active: true })
				}
			} else {
				chrome.tabs.create({ url })
			}
		})
	}
	if (command == 'copy-link') {
		chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
			const tab = tabs[0]
			const text = `${tab.title}\n${tab.url}`
			chrome.tabs.sendMessage(
				tab.id,
				{
					message: 'copyText',
					textToCopy: text,
				},
				function (response) {},
			)
			// window.navigator.clipboard.writeText(text)
		})
	}

	if (command == 'screenshot-area') {
		console.log({ openedTab })
		getCurrentTab().then((tab) => {
			// console.log({ tab });

			// chrome.windows.create({
			// 	url: chrome.runtime.getURL("index.html#/about"),
			// 	type: "popup",
			// });
			// chrome.action.openPopup().then(() => {
			// 	console.log("opened");
			// });
			chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataURI) => {
				// console.log(dataURI);
				// addToClipboard(dataURI);
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
				// chrome.tabs.create(
				// 	{ url: chrome.runtime.getURL("index.html") },
				// 	(poptab) => {
				// 		setTimeout(() => {
				// 			chrome.tabs.sendMessage(
				// 				poptab.id,
				// 				{ name: "stream", dataURI },
				// 				(response) => console.log(response),
				// 			);
				// 		}, 500);
				// 	},
				// );
			})
		})
		// chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
		// 	const tab = tabs[0]
		// 	// chrome.tabCapture.capture({ video: true }, (stream) => {
		// 	// 	console.log({ stream })
		// 	// 	if (stream.id) {
		// 	// 		setTimeout(() => {
		// 	// 			chrome.tabs.sendMessage(tab.id, { name: 'stream', streamId: stream.id }, (response) =>
		// 	// 				console.log(response)
		// 	// 			)
		// 	// 		}, 200)
		// 	// 	}
		// 	// })
		// 	chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], tab, (streamId) => {
		// 		//check whether the user canceled the request or not
		// 		if (streamId && streamId.length) {
		// 			console.log({ name: 'stream', streamId })
		// 			setTimeout(() => {
		// 				chrome.tabs.sendMessage(tab.id, { name: 'stream', streamId }, (response) =>
		// 					console.log(response)
		// 				)
		// 			}, 200)
		// 		}
		// 	})
		// })
	}
})

// chrome.action.onClicked.addListener(function (tab) {
// 	chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], tab, (streamId) => {
// 		//check whether the user canceled the request or not
// 		if (streamId && streamId.length) {
// 			setTimeout(() => {
// 				chrome.tabs.sendMessage(tab.id, { name: 'stream', streamId }, (response) =>
// 					console.log(response)
// 				)
// 			}, 200)
// 		}
// 	})
// })

chrome.runtime.onMessage.addListener((message, sender, senderResponse) => {
	console.log({ message })
	if (message?.name === 'download' && message.url) {
		chrome.downloads.download(
			{
				filename: 'screenshot.png',
				url: message.url,
			},
			(downloadId) => {
				senderResponse({ success: true })
			},
		)

		return true
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
async function addToClipboard(value) {
	// await chrome.offscreen.createDocument({
	// 	url: "offscreen.html",
	// 	reasons: [chrome.offscreen.Reason.CLIPBOARD],
	// 	justification: "Write text to the clipboard.",
	// });
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
async function addToClipboardV2(value) {
	navigator.clipboard.writeText(value)
}
// const getTabCount = async () => {
// 	const tabs = await chrome.tabs.query({})
// 	console.log(tabs.length.toString())
// 	// chrome.action.setBadgeText({ text: tabs.length.toString() })
// 	chrome.action.setBadgeText({ text: '' })
// 	chrome.action.setBadgeBackgroundColor({ color: '#9688F1' })
// }
// // listen to event for changes from saved data in storage
// chrome.tabs.onUpdated.addListener(getTabCount)
// chrome.tabs.onRemoved.addListener(getTabCount)
// Chrome Extensions: Adding a badge - DEV Community
// https://dev.to/paulasantamaria/chrome-extensions-adding-a-badge-644

// Chrome extension — How to add a badge on your extension’s icon | by Anna Ikoki | extensions development | Medium
// https://medium.com/extensions-development/chrome-extension-how-to-add-a-badge-on-your-extensions-icon-c3385b00932b
