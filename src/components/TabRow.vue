<script setup lang="ts">
import { format, formatDistance } from 'date-fns'
import { Disclosure, DisclosureButton } from '@headlessui/vue'
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
	<Disclosure v-slot="{ open }">
		<tr
			:class="{
				'bg-vercel-accents-2': tabsSelected.has(tab.stableId),
			}"
		>
			<!-- Tab Info Column -->
			<td class="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
				<div class="flex items-center">
					<div class="flex items-center space-x-3">
						<!-- Selection Checkbox -->
						<button
							@click="emit('toggleSelection', tab)"
							class="flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 dark:border-vercel-accents-2 dark:bg-black dark:text-slate-300 dark:hover:bg-vercel-accents-1"
							:class="{
								'bg-blue-600 border-blue-600 text-white dark:bg-blue-600 dark:border-blue-600': tabsSelected.has(tab.stableId),
							}"
						>
							<PlusIcon v-if="!tabsSelected.has(tab.stableId)" class="h-3 w-3" />
							<MinusIcon v-else class="h-3 w-3" />
						</button>

						<!-- Favicon -->
						<div class="shrink-0">
							<div class="relative">
								<img
									v-if="!hasImageError && tab.favIconUrl"
									class="h-6 w-6 rounded"
									:src="tab.favIconUrl"
									alt=""
									@error="onImageLoadError"
								/>
								<div
									v-else
									class="h-6 w-6 rounded bg-slate-300 dark:bg-vercel-accents-3"
								></div>

								<!-- Group Color Indicator -->
								<div
									v-if="loadedGroups.find((row) => row.id === tab.groupId)?.color"
									class="absolute -top-1 -right-1 h-2 w-2 rounded-full border border-white dark:border-black"
									:style="{
										backgroundColor: loadedGroups.find(
											(row) => row.id === tab.groupId,
										)?.color,
									}"
								></div>
							</div>
						</div>

						<!-- Tab Info -->
						<div class="min-w-0 flex-1">
							<button
								@click="goTo(tab)"
								class="text-left"
								:title="tab.url"
							>
								<div class="font-medium text-slate-900 dark:text-white truncate">
									{{ tab.title }}
								</div>
								<div class="text-slate-500 dark:text-vercel-accents-4 truncate">
									{{ getHostname(tab.url) }}
								</div>
							</button>
						</div>
					</div>
				</div>
			</td>

			<!-- Actions Column -->
			<td class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
				<div class="flex items-center justify-end space-x-2">
					<DisclosureButton as="template">
						<button
							class="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-vercel-accents-2 dark:hover:text-slate-300"
							:class="{
								'bg-slate-100 text-slate-600 dark:bg-vercel-accents-2 dark:text-slate-300': open,
							}"
						>
							<ChevronUpIcon
								class="h-4 w-4 transition-transform duration-200"
								:class="{ 'rotate-180': !open }"
							/>
						</button>
					</DisclosureButton>
					<TabMoveToMenu
						:tabs="[tab]"
						:loaded-groups="loadedGroups"
						:windows-map="windowsMap"
						:can-create-group="false"
					>
						<template #menu-trigger-label>
							Move
						</template>
					</TabMoveToMenu>
					<button
						@click="copyLink(tab)"
						class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-vercel-accents-2 dark:bg-black dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-1"
					>
						Copy
					</button>
					<button
						@click="closeTab([tab])"
						class="rounded-full p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
					>
						<XMarkIcon class="h-4 w-4" />
					</button>
				</div>
			</td>
		</tr>

		<!-- History Panel -->
		<tr v-if="open">
			<td colspan="2" class="px-6 py-4 bg-slate-50 dark:bg-vercel-accents-1">
				<div class="space-y-3">
					<h4 class="text-xs font-semibold text-slate-700 dark:text-vercel-accents-5 uppercase tracking-wide">
						Visit History
					</h4>
					<div class="max-h-32 space-y-2 overflow-y-auto">
						<div
							v-for="historyEvent in tabHistory.slice(0, 5)"
							:key="historyEvent.id"
							class="flex items-center justify-between py-1"
						>
							<div class="flex items-center space-x-2">
								<div class="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-vercel-accents-4"></div>
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
			</td>
		</tr>
	</Disclosure>
</template>
