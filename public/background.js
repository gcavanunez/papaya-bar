// Get the current tab
const getCurrentTab = async () => {
	const queryOptions = { active: true, currentWindow: true }
	const [tab] = await chrome.tabs.query(queryOptions)
	return tab
}

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
				function (response) {}
			)
			// window.navigator.clipboard.writeText(text)
		})
	}

	if (command == 'screenshot-area') {
		console.log({ openedTab })
		getCurrentTab().then((tab) => {
			console.log({ tab })
			chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataURI) => {
				// chrome.tabs.sendMessage(tab.id, { name: 'stream', streamId }, (response) =>
				console.log({ dataURI })
				chrome.tabs.sendMessage(tab.id, { name: 'stream', dataURI }, (response) =>
					console.log(response)
				)
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
	if (message.name === 'download' && message.url) {
		chrome.downloads.download(
			{
				filename: 'screenshot.png',
				url: message.url,
			},
			(downloadId) => {
				senderResponse({ success: true })
			}
		)

		return true
	}
})
