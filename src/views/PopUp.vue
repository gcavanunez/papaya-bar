<script setup lang="ts">
import { copyLink } from '@/helpers'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import {
	ArrowTopRightOnSquareIcon,
	CameraIcon,
	DocumentDuplicateIcon,
} from '@heroicons/vue/24/outline'

const { loadedTabs, initlisteners } = useChromeTabs()
initlisteners()

const copyOpenTab = async () => {
	const current = await chrome.windows.getCurrent()
	const tab = loadedTabs.value.find((row) => row.active && row.windowId == current.id)
	if (tab) {
		copyLink(tab)
	}
}
const openTabs = () => {
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
function screenshotArea() {
	chrome.runtime.sendMessage(chrome.runtime.id, 'screenshot-area', function (response) {
		console.log(response)
	})
}
</script>
<template>
	<div class="h-[240px] w-[360px] bg-slate-100 antialiased">
		<div class="relative flex h-full flex-col">
			<div class="flex-shrink-0 bg-white shadow-sm">
				<div class="flex items-center justify-center pb-6 pt-8">
					<div>
						<img
							class="block h-16 w-auto"
							src="/assets/papaya-icon-next.png"
							alt="Papita from Papaya Bar"
						/>
					</div>
				</div>
				<div class="px-3 pb-6">
					<h1 class="text-center text-2xl font-bold leading-snug text-slate-700">
						{{ loadedTabs.length }} tabs
					</h1>
				</div>
			</div>
			<div class="flex-grow overflow-y-auto"></div>
			<div class="flex flex-shrink-0 items-start p-1">
				<div class="w-1/3">
					<button
						class="inline-flex h-16 w-full select-none items-center justify-center rounded-md transition-all hover:bg-white"
						@click="copyOpenTab"
					>
						<div class="w-full text-gray-600">
							<div class="flex justify-center pb-1">
								<DocumentDuplicateIcon class="h-6 w-6"></DocumentDuplicateIcon>
							</div>
							<div class="text-xs">Copy Link</div>
						</div>
					</button>
				</div>
				<div class="w-1/3">
					<button
						class="inline-flex h-16 w-full select-none items-center justify-center rounded-md transition-all hover:bg-white"
						@click="screenshotArea"
					>
						<div class="w-full text-gray-600">
							<div class="flex justify-center pb-1">
								<CameraIcon class="h-6 w-6"></CameraIcon>
							</div>
							<div class="text-xs">Screenshot Tab</div>
						</div>
					</button>
				</div>
				<div class="w-1/3">
					<button
						class="inline-flex h-16 w-full select-none items-center justify-center rounded-md transition-all hover:bg-white"
						@click="openTabs"
					>
						<div class="w-full text-gray-600">
							<div class="flex justify-center pb-1">
								<ArrowTopRightOnSquareIcon
									class="h-6 w-6"
								></ArrowTopRightOnSquareIcon>
							</div>
							<div class="text-xs">Open Manager</div>
						</div>
					</button>
				</div>
			</div>
		</div>
	</div>
</template>
