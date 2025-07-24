<script setup lang="ts">
import { format, formatDistance } from 'date-fns'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { PlusIcon, XMarkIcon, MinusIcon, ChevronUpIcon } from '@heroicons/vue/20/solid'
import { closeTab, copyLink, goTo } from '@/helpers'
import { Tab, HistoryMap, Group } from '@/types'
import { computed, ref } from 'vue'

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
const hasImageError = ref(false)
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
	<div class="group relative">
		<Disclosure v-slot="{ open }">
			<div
				class="relative overflow-hidden rounded-xl bg-white/80 dark:bg-slate-700/80 backdrop-blur-sm border border-slate-200/50 dark:border-slate-600/50 shadow-sm transition-all duration-200 hover:shadow-md"
				:class="{
					'ring-2 ring-blue-500/50 border-blue-500/50': tabsSelected.has(tab.stableId),
					'hover:border-slate-300/70 dark:hover:border-slate-500/70': !tabsSelected.has(tab.stableId),
				}"
			>
				<!-- Action Overlay -->
				<div class="absolute inset-0 z-10 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl">
					<div class="absolute top-2 left-2">
						<button
							@click="emit('toggleSelection', tab)"
							class="flex items-center justify-center w-6 h-6 rounded-full bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-slate-200/50 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors shadow-sm"
						>
							<PlusIcon v-if="!tabsSelected.has(tab.stableId)" class="h-3 w-3" />
							<MinusIcon v-else class="h-3 w-3" />
						</button>
					</div>
					
					<div class="absolute top-2 right-2 flex items-center space-x-1">
						<DisclosureButton as="template">
							<button
								class="flex items-center justify-center w-6 h-6 rounded-full bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-slate-200/50 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors shadow-sm"
								:class="{ 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400': open }"
							>
								<ChevronUpIcon
									class="h-3 w-3 transition-transform duration-200"
									:class="{ 'rotate-180': !open }"
								/>
							</button>
						</DisclosureButton>
						<button
							@click="closeTab([tab])"
							class="flex items-center justify-center w-6 h-6 rounded-full bg-red-50/90 dark:bg-red-900/50 backdrop-blur-sm border border-red-200/50 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/70 transition-colors shadow-sm"
						>
							<XMarkIcon class="h-3 w-3" />
						</button>
					</div>
					
					<div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
						<TabMoveToMenu
							:tabs="[tab]"
							:loaded-groups="loadedGroups"
							:windows-map="windowsMap"
							:can-create-group="false"
						>
							<template #menu-trigger-label>
								<span class="px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-md border border-slate-200/50 dark:border-slate-600/50 hover:bg-white dark:hover:bg-slate-700 transition-colors shadow-sm">
									Move
								</span>
							</template>
						</TabMoveToMenu>
						<button
							@click="copyLink(tab)"
							class="px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-md border border-slate-200/50 dark:border-slate-600/50 hover:bg-white dark:hover:bg-slate-700 transition-colors shadow-sm"
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
									class="w-8 h-8 rounded-lg shadow-sm"
									:src="tab.favIconUrl"
									alt=""
									@error="onImageLoadError"
								/>
								<div v-else class="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700"></div>
								
								<!-- Group Color Indicator -->
								<div
									v-if="loadedGroups.find((row) => row.id === tab.groupId)?.color"
									class="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-slate-700"
									:style="{ backgroundColor: loadedGroups.find((row) => row.id === tab.groupId)?.color }"
								></div>
							</div>
						</div>
						
						<div class="flex-1 min-w-0">
							<h3 class="text-sm font-medium text-slate-900 dark:text-white truncate mb-1">
								{{ tab.title }}
							</h3>
							<p class="text-xs text-slate-500 dark:text-slate-400 truncate">
								{{ getHostname(tab.url) }}
							</p>
						</div>
					</div>
				</button>
			</div>
			
			<!-- History Panel -->
			<DisclosurePanel class="border-t border-slate-200/50 dark:border-slate-600/50 bg-slate-50/50 dark:bg-slate-800/50 p-4">
				<div class="space-y-3">
					<h4 class="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
						Visit History
					</h4>
					<div class="space-y-2 max-h-32 overflow-y-auto">
						<div
							v-for="historyEvent in tabHistory.slice(0, 5)"
							:key="historyEvent.id"
							class="flex items-center justify-between py-1"
						>
							<div class="flex items-center space-x-2">
								<div class="w-1.5 h-1.5 rounded-full bg-blue-400 dark:bg-blue-500"></div>
								<span class="text-xs text-slate-600 dark:text-slate-400">
									{{ historyEvent.humanDistance }} ago
								</span>
							</div>
							<span class="text-xs text-slate-500 dark:text-slate-500 font-mono">
								{{ historyEvent.dateTime }}
							</span>
						</div>
						<div v-if="tabHistory.length > 5" class="text-xs text-slate-500 dark:text-slate-500 text-center py-1">
							+{{ tabHistory.length - 5 }} more visits
						</div>
						<div v-if="tabHistory.length === 0" class="text-xs text-slate-500 dark:text-slate-500 text-center py-2">
							No visit history available
						</div>
					</div>
				</div>
			</DisclosurePanel>
		</Disclosure>
	</div>
</template>
