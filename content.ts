import { copyImageToClipboard, copyToClipboard } from './src/utils'

chrome.runtime.onMessage.addListener(
	// this is the message listener
	function (request, _sender, sendResponse) {
		if (request.message === 'copyText') {
			copyToClipboard(request.textToCopy)
			sendResponse({ success: true })
		}

		if (request.name === 'stream' && request.dataURI) {
			copyImageToClipboard(request.dataURI)
				.then(() => {
					sendResponse({ success: true })
				})
				.catch((err) => {
					alert('Could not take screenshot')
					sendResponse({ success: false, message: err })
				})
			return true
		}
	},
)






