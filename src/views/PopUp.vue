<script setup lang="ts">
import { copyLink } from '@/helpers'
import { copyImageToClipboard } from '@/utils'
import {
	ArrowTopRightOnSquareIcon,
	CameraIcon,
	DocumentDuplicateIcon,
} from '@heroicons/vue/24/outline'
import { useTimeoutFn } from '@vueuse/core'
import { onMounted, ref } from 'vue'
import { useMotion } from '@vueuse/motion'
import { useSettings } from '@/hooks/useSettings'

const loadedTabs = ref(0)
const { settings, loadSettings } = useSettings()

const copiedLink = ref<'link' | 'screen' | ''>('')

const target = ref<HTMLElement>()
const itemMoved = ref<HTMLElement>()

const { apply } = useMotion(target, {
	initial: {
		opacity: 0,
	},
})

const { apply: itemMovedApply } = useMotion(itemMoved, {
	initial: {
		y: 0,
	},
})

const { start } = useTimeoutFn(() => {
	copiedLink.value = ''
	apply('initial')
	itemMovedApply('initial')
}, 700)

onMounted(async () => {
	loadSettings()
	
	chrome.tabs.query({}, (tabs) => {
		loadedTabs.value = tabs.length
	})

	const response = await chrome.runtime.sendMessage({ type: 'popup-ready' })

	if (response) {
		copiedLink.value = 'screen'
		start()
		copyImageToClipboard(response.dataURI)
	}
})

const copyOpenTab = async () => {
	copiedLink.value = 'link'
	await Promise.all([
		apply({
			opacity: 1,
			transition: {
				type: 'tween',
				delay: 100,
				duration: 300,
			},
		}),
		itemMovedApply({
			y: -10,
			transition: {
				type: 'tween',
				duration: 300,
			},
		}),
	])

	start()
	const tab = await getCurrentTab()
	if (tab) {
		copyLink(tab, settings.value.copyLinksInMarkdownFormat)
	}
}
const openTabs = () => {
	const url = 'chrome-extension://' + chrome.runtime.id + '/index.html'
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
	copiedLink.value = 'screen'
	start()

	getCurrentTab().then((tab) => {
		chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataURI) => {
			copyImageToClipboard(dataURI)
		})
	})
}

async function getCurrentTab() {
	const queryOptions = { active: true, currentWindow: true }
	const [tab] = await chrome.tabs.query(queryOptions)
	return tab
}
</script>

<template>
	<div class="h-[240px] w-[360px] bg-slate-100 antialiased">
		<div class="relative flex h-full flex-col">
			<div class="z-0 shrink-0 bg-white shadow-sm">
				<div class="flex items-center justify-center pt-8 pb-6">
					<div>
						<img
							class="block h-16 w-auto"
							src="/assets/papaya-icon-next.png"
							alt="Papita from Papaya Bar"
						/>
					</div>
				</div>
				<div class="px-3 pb-6">
					<h1 class="text-center text-2xl leading-snug font-bold text-slate-700">
						{{ loadedTabs }} tabs
					</h1>
				</div>
			</div>
			<div class="grow overflow-y-auto"></div>
			<div class="flex shrink-0 items-start bg-slate-100 p-1">
				<div class="w-1/3">
					<button
						class="relative inline-flex h-16 w-full items-center justify-center rounded-md transition-all select-none hover:bg-white"
						@click="copyOpenTab"
					>
						<div
							class="absolute inset-x-0 bottom-1 inline-flex items-center justify-center"
						>
							<div ref="target" class="text-xs text-green-500">Copied!</div>
						</div>
						<div ref="itemMoved" class="w-full text-gray-600 transition-all">
							<div class="flex justify-center pb-1">
								<DocumentDuplicateIcon class="h-6 w-6"></DocumentDuplicateIcon>
							</div>
							<div class="text-xs">Copy Link</div>
						</div>
					</button>
				</div>
				<div class="w-1/3">
					<button
						class="inline-flex h-16 w-full items-center justify-center rounded-md transition-all select-none hover:bg-white"
						@click="screenshotArea"
					>
						<div class="w-full text-gray-600">
							<div class="flex justify-center pb-1">
								<CameraIcon class="h-6 w-6"></CameraIcon>
							</div>
							<div class="text-xs">Screenshot Tab</div>
							<transition
								enter-active-class="transition duration-200 ease-out"
								enter-from-class="translate-y-1 opacity-0"
								enter-to-class="translate-y-0 opacity-100"
								leave-active-class="transition duration-150 ease-in"
								leave-from-class="translate-y-0 opacity-100"
								leave-to-class="translate-y-1 opacity-0"
							>
								<div
									v-show="copiedLink === 'screen'"
									class="text-xs text-green-500"
								>
									Copied!
								</div>
							</transition>
						</div>
					</button>
				</div>
				<div class="w-1/3">
					<button
						class="inline-flex h-16 w-full items-center justify-center rounded-md transition-all select-none hover:bg-white"
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
