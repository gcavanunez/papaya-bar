<script setup lang="ts">
import { format, formatDistance } from 'date-fns'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { PlusIcon, XMarkIcon, MinusIcon, ChevronUpIcon } from '@heroicons/vue/20/solid'
import { closeTab, copyLink, goTo } from '@/helpers'
import { Tab, HistoryMap, Group } from '@/types'
import { computed, onMounted, ref } from 'vue'
import { useSettings } from '@/hooks/useSettings'

import TabMoveToMenu from './TabMoveToMenu.vue'

interface Props {
	tab: Tab
	tabsSelected: Set<string>
	windowsMap: Map<number, string>
	loadedGroups: Group[]
	history: HistoryMap
}
const props = defineProps<Props>()

const emit = defineEmits<{
	(e: 'toggleSelection', tab: Tab): void
}>()

const { settings, loadSettings } = useSettings()
const hasImageError = ref(false)

const copyTabLink = (tab: Tab) => {
	copyLink(tab, settings.value.copyLinksInMarkdownFormat)
}

onMounted(() => {
	loadSettings()
})
const onImageLoadError = () => {
	hasImageError.value = true
}
const getHostname = (url?: string) => {
	if (!url) return 'Unknown'
	try {
		return new URL(url).hostname
	} catch {
		return 'Unknown'
	}
}

const tabHistory = computed(() => {
	if (!props.tab.url) {
		return []
	}
	const hasHistory = props.history.get(props.tab.url)
	if (!hasHistory) {
		return []
	}
	return [...hasHistory]
		.sort((a, b) => new Date(b.visitTime!).getTime() - new Date(a.visitTime!).getTime())
		.map((row) => ({
			...row,
			humanDistance: formatDistance(new Date(row.visitTime!), new Date()),
			dateTime: format(new Date(row.visitTime!), 'hh:mm aaa MM/dd/yyyy'),
		}))
})
</script>

<template>
	<div class="relative">
		<Disclosure v-slot="{ open }">
			<div
				class="group relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md dark:border-vercel-accents-2 dark:bg-black"
				:class="{
					'border-blue-500 ring-2 ring-blue-500/20': tabsSelected.has(tab.stableId),
					'hover:border-slate-300 dark:hover:border-vercel-accents-3': !tabsSelected.has(
						tab.stableId,
					),
				}"
			>
				<!-- Action Overlay -->
				<div
					class="pointer-events-none absolute inset-0 z-10 rounded-lg bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
				>
					<div class="pointer-events-auto absolute top-2 left-2">
						<button
							@click="emit('toggleSelection', tab)"
							class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-vercel-accents-2 dark:bg-black/90 dark:text-slate-300 dark:hover:bg-vercel-accents-1"
						>
							<PlusIcon v-if="!tabsSelected.has(tab.stableId)" class="h-3 w-3" />
							<MinusIcon v-else class="h-3 w-3" />
						</button>
					</div>

					<div
						class="pointer-events-auto absolute top-2 right-2 flex items-center space-x-1"
					>
						<DisclosureButton as="template">
							<button
								class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-vercel-accents-2 dark:bg-black/90 dark:text-slate-300 dark:hover:bg-vercel-accents-1"
								:class="{
									'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400':
										open,
								}"
							>
								<ChevronUpIcon
									class="h-3 w-3 transition-transform duration-200"
									:class="{ 'rotate-180': !open }"
								/>
							</button>
						</DisclosureButton>
						<button
							@click="closeTab([tab])"
							class="flex h-6 w-6 items-center justify-center rounded-full border border-red-200 bg-red-50/90 text-red-600 shadow-sm transition-colors hover:bg-red-100 dark:border-red-800/50 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-900/70"
						>
							<XMarkIcon class="h-3 w-3" />
						</button>
					</div>

					<div
						class="pointer-events-auto absolute right-2 bottom-2 left-2 flex items-center justify-between"
					>
						<TabMoveToMenu
							:tabs="[tab]"
							:loaded-groups="loadedGroups"
							:windows-map="windowsMap"
							:can-create-group="false"
						>
							<template #menu-trigger-label>
								<span class="rounded-md bg-purple-50/90 px-2 py-1 text-xs font-medium text-purple-600 shadow-sm transition-colors hover:bg-purple-100 dark:bg-purple-900/50 dark:text-purple-400 dark:hover:bg-purple-900/70">
									Move
								</span>
							</template>
						</TabMoveToMenu>
						<button
							@click="copyTabLink(tab)"
							class="rounded-md bg-green-50/90 px-2 py-1 text-xs font-medium text-green-600 shadow-sm transition-colors hover:bg-green-100 dark:bg-green-900/50 dark:text-green-400 dark:hover:bg-green-900/70"
						>
							Copy
						</button>
					</div>
				</div>

				<!-- Tab Content -->
				<button
					@click="goTo(tab)"
					class="w-full p-4 text-left transition-colors duration-200"
					:title="tab.url"
				>
					<div class="flex items-start space-x-3">
						<div class="shrink-0">
							<div class="relative">
								<img
									v-if="!hasImageError && tab.favIconUrl"
									class="h-8 w-8 rounded-lg shadow-sm"
									:src="tab.favIconUrl"
									alt=""
									@error="onImageLoadError"
								/>
								<div
									v-else
									class="h-8 w-8 rounded-lg bg-slate-300 dark:bg-vercel-accents-3"
								></div>

								<!-- Group Color Indicator -->
								<div
									v-if="loadedGroups.find((row) => row.id === tab.groupId)?.color"
									class="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white dark:border-black"
									:style="{
										backgroundColor: loadedGroups.find(
											(row) => row.id === tab.groupId,
										)?.color,
									}"
								></div>
							</div>
						</div>

						<div class="min-w-0 flex-1">
							<h3
								class="mb-1 truncate text-sm font-medium text-slate-900 dark:text-white"
							>
								{{ tab.title }}
							</h3>
							<p class="truncate text-xs text-slate-500 dark:text-vercel-accents-4">
								{{ getHostname(tab.url) }}
							</p>
						</div>
					</div>
				</button>
			</div>

			<!-- History Panel -->
			<DisclosurePanel
				class="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-vercel-accents-2 dark:bg-vercel-accents-1"
			>
				<div class="space-y-3">
					<h4
						class="text-xs font-semibold tracking-wide text-slate-700 uppercase dark:text-vercel-accents-5"
					>
						Visit History
					</h4>
					<div class="max-h-32 space-y-2 overflow-y-auto">
						<div
							v-for="historyEvent in tabHistory.slice(0, 5)"
							:key="historyEvent.id"
							class="flex items-center justify-between py-1"
						>
							<div class="flex items-center space-x-2">
								<div
									class="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-vercel-accents-4"
								></div>
								<span class="text-xs text-slate-600 dark:text-vercel-accents-4">
									{{ historyEvent.humanDistance }} ago
								</span>
							</div>
							<span class="font-mono text-xs text-slate-500 dark:text-vercel-accents-5">
								{{ historyEvent.dateTime }}
							</span>
						</div>
						<div
							v-if="tabHistory.length > 5"
							class="py-1 text-center text-xs text-slate-500 dark:text-vercel-accents-5"
						>
							+{{ tabHistory.length - 5 }} more visits
						</div>
						<div
							v-if="tabHistory.length === 0"
							class="py-2 text-center text-xs text-slate-500 dark:text-vercel-accents-5"
						>
							No visit history available
						</div>
					</div>
				</div>
			</DisclosurePanel>
		</Disclosure>
	</div>
</template>
