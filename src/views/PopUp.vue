<script setup lang="ts">
import { copyLink } from '@/helpers'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { RectangleGroupIcon, ClipboardDocumentIcon } from '@heroicons/vue/20/solid'

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
	// chrome.extension.
	// const optionsUrl = chrome.extension.getURL('index.html')
	// chrome.tabs.create({
	//   url: 'chrome-extension://' + chrome.runtime.id + '/index.html',
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
	// chrome.tabs.create({ url: optionsUrl })
	// console.log({ optionsUrl })
}
</script>
<template>
	<div class="w-48">
		<ul role="list" class="divide-y divide-gray-200">
			<li class="flex w-full">
				<div class="w-full py-2 px-1 text-left text-slate-700">
					All Tabs - {{ loadedTabs.length }}
				</div>
			</li>
			<li class="flex w-full">
				<button
					@click="openTabs"
					type="button"
					class="flex w-full items-center py-2 px-1 hover:bg-slate-200"
				>
					<RectangleGroupIcon class="h-6 w-6 rounded-full"></RectangleGroupIcon>
					<div class="ml-3">
						<p class="text-sm font-medium text-gray-900">Manage</p>
					</div>
				</button>
			</li>
			<li class="flex w-full">
				<button
					@click="copyOpenTab"
					type="button"
					class="flex w-full items-center py-2 px-1 hover:bg-slate-200"
				>
					<ClipboardDocumentIcon class="h-6 w-6 rounded-full"></ClipboardDocumentIcon>
					<div class="ml-3">
						<p class="text-sm font-medium text-gray-900">Copy</p>
					</div>
				</button>
			</li>
		</ul>
	</div>
</template>
