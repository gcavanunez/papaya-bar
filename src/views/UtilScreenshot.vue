<script setup lang="ts">
import { ref } from 'vue'

const isLoading = ref(true)
chrome.runtime.onMessage.addListener(
	// this is the message listener
	function (request, sender, sendResponse) {
		if (request.name === 'stream' && request.dataURI) {
			copyImageToClipboard(request.dataURI)
				.then(() => {
					sendResponse({ success: true })
				})
				.catch((err) => {
					alert('Could not take screenshot')
					sendResponse({ success: false, message: err })
				})
				.finally(() => {
					isLoading.value = false
					setTimeout(() => {
						window.close()
					}, 1000)
				})

			return true
		}
	},
)

async function copyImageToClipboard(img: string) {
	const blob = await getImageBlobFromUrl(img)
	console.log({ blob })
	await navigator.clipboard.write([
		new ClipboardItem({
			[blob.type]: blob,
		}),
	])
}

async function getImageBlobFromUrl(url: string) {
	const fetchedImageData = await fetch(url)
	const blob = await fetchedImageData.blob()
	return blob
}
</script>

<template>
	<div>
		<div class="relative overflow-auto rounded-xl p-8">
			<div class="flex items-center justify-center">
				<button v-if="isLoading" type="button"
					class="inline-flex cursor-not-allowed items-center rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold leading-6 text-white shadow transition duration-150 ease-in-out hover:bg-indigo-400">
					<svg class="-ml-1 mr-3 h-5 w-5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg"
						fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
						</circle>
						<path class="opacity-75" fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
						</path>
					</svg>
					Processing...
				</button>
				<span v-else> Coppied! </span>
			</div>
		</div>
	</div>
</template>
