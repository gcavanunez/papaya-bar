<script setup lang="ts">
import { copyLink } from '@/helpers'
import { copyImageToClipboard } from '@/utils'
import {
	ArrowTopRightOnSquareIcon,
	CameraIcon,
	DocumentDuplicateIcon,
	RectangleStackIcon,
} from '@heroicons/vue/24/outline'
import { useTimeoutFn } from '@vueuse/core'
import { onMounted, ref } from 'vue'
import { useMotion } from '@vueuse/motion'
import { useSettings } from '@/hooks/useSettings'

const loadedTabs = ref(0)
const windowCount = ref(0)
const currentWindowId = ref<number | null>(null)
const { settings, loadSettings } = useSettings()

// Shortcut hints mirror the chrome.commands defaults in manifest.json
const isMac = /mac/i.test(navigator.platform)
const mod = isMac ? '⌘⇧' : 'Ctrl+Shift+'

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

	chrome.windows.getCurrent({}, (win) => {
		currentWindowId.value = win?.id ?? null
	})

	chrome.tabs.query({}, (tabs) => {
		loadedTabs.value = tabs.length
		windowCount.value = new Set(tabs.map((tab) => tab.windowId)).size
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
// Open the Contexts side panel. Called synchronously from the click handler
// (using the cached window id) so the user gesture is preserved.
const openContextsPanel = () => {
	if (chrome.sidePanel && currentWindowId.value != null) {
		chrome.sidePanel.open({ windowId: currentWindowId.value })
		window.close()
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
	<div class="w-[360px] bg-white antialiased dark:bg-black">
		<div class="flex flex-col">
			<!-- Header -->
			<div class="relative flex flex-col items-center overflow-hidden px-4 pt-6 pb-4">
				<div
					class="bg-papaya-500/25 dark:bg-papaya-500/10 pointer-events-none absolute -top-12 h-36 w-64 rounded-full blur-3xl"
				></div>
				<img
					class="relative block h-14 w-auto"
					src="/assets/papaya-icon-next.png"
					alt="Papita from Papaya Bar"
				/>
				<h1
					class="relative mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
				>
					{{ loadedTabs }}
				</h1>
				<p class="dark:text-vercel-accents-5 relative text-xs text-slate-500">
					tabs across {{ windowCount }} window{{ windowCount === 1 ? '' : 's' }}
				</p>
			</div>

			<!-- Primary action -->
			<div class="px-4 pb-4">
				<button
					class="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-white dark:text-black dark:hover:bg-slate-200"
					@click="openContextsPanel"
				>
					<RectangleStackIcon class="h-5 w-5" />
					Open Contexts
					<kbd
						class="ml-1 rounded border border-white/30 px-1 font-mono text-[10px] opacity-70 dark:border-black/30"
						>{{ mod }}E</kbd
					>
				</button>
			</div>

			<!-- Quick actions -->
			<div
				class="dark:border-vercel-accents-2 dark:bg-vercel-accents-1 grid grid-cols-3 gap-1 border-t border-slate-200 bg-slate-50 p-1.5"
			>
				<button
					class="dark:hover:bg-vercel-accents-2 relative h-[72px] rounded-md transition-colors select-none hover:bg-white"
					@click="copyOpenTab"
				>
					<div class="absolute inset-x-0 bottom-1 flex items-center justify-center">
						<div ref="target" class="text-xs font-medium text-green-500">Copied!</div>
					</div>
					<div
						ref="itemMoved"
						class="dark:text-vercel-accents-5 w-full text-gray-600 transition-all"
					>
						<div class="flex justify-center pb-1">
							<DocumentDuplicateIcon class="h-6 w-6" />
						</div>
						<div class="text-[11px]">Copy Link</div>
						<kbd class="dark:text-vercel-accents-4 font-mono text-[9px] text-slate-400"
							>{{ mod }}1</kbd
						>
					</div>
				</button>
				<button
					class="dark:hover:bg-vercel-accents-2 relative h-[72px] rounded-md transition-colors select-none hover:bg-white"
					@click="screenshotArea"
				>
					<div class="absolute inset-x-0 bottom-1 flex items-center justify-center">
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
								class="dark:bg-vercel-accents-2 rounded bg-white px-1.5 text-xs font-medium text-green-500"
							>
								Copied!
							</div>
						</transition>
					</div>
					<div class="dark:text-vercel-accents-5 w-full text-gray-600">
						<div class="flex justify-center pb-1">
							<CameraIcon class="h-6 w-6" />
						</div>
						<div class="text-[11px]">Screenshot Tab</div>
						<kbd class="dark:text-vercel-accents-4 font-mono text-[9px] text-slate-400"
							>{{ mod }}2</kbd
						>
					</div>
				</button>
				<button
					class="dark:hover:bg-vercel-accents-2 relative h-[72px] rounded-md transition-colors select-none hover:bg-white"
					@click="openTabs"
				>
					<div class="dark:text-vercel-accents-5 w-full text-gray-600">
						<div class="flex justify-center pb-1">
							<ArrowTopRightOnSquareIcon class="h-6 w-6" />
						</div>
						<div class="text-[11px]">Open Manager</div>
						<kbd class="dark:text-vercel-accents-4 font-mono text-[9px] text-slate-400"
							>{{ mod }}K</kbd
						>
					</div>
				</button>
			</div>
		</div>
	</div>
</template>
