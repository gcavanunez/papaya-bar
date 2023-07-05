chrome.runtime.onMessage.addListener(
	// this is the message listener
	function (request, sender, sendResponse) {
		if (request.message === 'copyText') {
			copyToTheClipboard(request.textToCopy)
			sendResponse({ success: true })
		}
		// if (request.name === 'stream' && request.streamId) {
		// 	// if (message.message === 'stream' && message.streamId) {
		// 	// if (message.message === 'screenshot-area' && message.streamId) {
		// 	// if (message.message === 'screenshot-area') {
		// 	let track, canvas
		// 	navigator.mediaDevices
		// 		.getUserMedia({
		// 			video: {
		// 				mandatory: {
		// 					chromeMediaSource: 'desktop',
		// 					chromeMediaSourceId: request.streamId,
		// 				},
		// 			},
		// 		})
		// 		.then((stream) => {
		// 			track = stream.getVideoTracks()[0]
		// 			const imageCapture = new ImageCapture(track)
		// 			return imageCapture.grabFrame()
		// 		})
		// 		.then((bitmap) => {
		// 			track.stop()
		// 			canvas = document.createElement('canvas')
		// 			canvas.width = bitmap.width //if not set, the width will default to 200px
		// 			canvas.height = bitmap.height //if not set, the height will default to 200px
		// 			let context = canvas.getContext('2d')
		// 			context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height)
		// 			return canvas.toDataURL()
		// 		})
		// 		.then((url) => {
		// 			return copyImageToClipboard(url)
		// 			// chrome.runtime.sendMessage({ name: 'download', url }, (response) => {
		// 			// 	if (response.success) {
		// 			// 		alert('Screenshot saved')
		// 			// 	} else {
		// 			// 		alert('Could not save screenshot')
		// 			// 	}
		// 			// 	canvas.remove()
		// 			// 	senderResponse({ success: true })
		// 			// })
		// 		})
		// 		.then(() => {
		// 			canvas.remove()
		// 			sendResponse({ success: true })
		// 		})
		// 		.catch((err) => {
		// 			alert('Could not take screenshot')
		// 			sendResponse({ success: false, message: err })
		// 		})
		// 	return true
		// }
		if (request.name === 'stream' && request.dataURI) {
			// if (message.message === 'stream' && message.streamId) {
			// if (message.message === 'screenshot-area' && message.streamId) {
			// if (message.message === 'screenshot-area') {

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
	}
)

function copyToTheClipboard(textToCopy) {
	const el = document.createElement('textarea')
	el.value = textToCopy
	el.setAttribute('readonly', '')
	el.style.position = 'absolute'
	el.style.left = '-9999px'
	document.body.appendChild(el)
	el.select()
	document.execCommand('copy')
	document.body.removeChild(el)
}

async function copyImageToClipboard(img) {
	// const src = img.src
	// const imageMimeType = getImageMimeTypeFromUrl(src)
	// const blob = imageMimeType === 'image/svg'
	//   ? await getTextBlobFromUrl(src)
	//   : await getImageBlobFromUrl(src)
	const blob = await getImageBlobFromUrl(img)
	console.log({ blob })
	await navigator.clipboard.write([
		new ClipboardItem({
			[blob.type]: blob,
		}),
	])
}
// function getImageMimeTypeFromUrl(url) {
//   return `image/${url.match(/([a-z]+)$/)[0]}`
// }
async function getImageBlobFromUrl(url) {
	const fetchedImageData = await fetch(url)
	const blob = await fetchedImageData.blob()
	return blob
}
async function getTextBlobFromUrl(url) {
	const response = await fetch(url)
	const source = await response.text()
	return new Blob([source], { type: 'text/plain' })
}

// copyImageToClipboard(document.querySelector('.image-to-copy'))
// import { router } from '@/router'
// main.js
// .use(myPlugin, {
/* optional options */
// })
// const app = document.createElement('div')
// app.id = 'my-extension-root'
// document.body.appendChild(app)

// import { createApp } from 'vue'
// import 'focus-visible'
// import '@/index.css'
// import App from '@/ContentApp.vue'
// import 'v-calendar/dist/style.css'

// import VCalendar from 'v-calendar'

// createApp(App)
// 	.use(VCalendar, {})
// 	.directive('autogrow', {
// 		created(el) {
// 			el.addEventListener('input', () => {
// 				el.style.height = 'auto'
// 				el.style.height = el.scrollHeight + 'px'
// 			})
// 		},
// 		mounted(el) {
// 			el.style.height = 'auto'
// 			el.style.height = el.scrollHeight + 'px'
// 		},
// 	})
// 	.mount('#my-extension-root')
