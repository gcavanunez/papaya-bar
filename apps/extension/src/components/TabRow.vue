<script setup lang="ts">
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
	ArrowsRightLeftIcon,
	ClockIcon,
	DocumentDuplicateIcon,
	MapPinIcon,
	SpeakerWaveIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import { Tab, HistoryMap, Group } from '@/types'
import { computed, ref } from 'vue'
import { getDisplayUrl } from '@/lib/format'
import { button } from '@/lib/ui'
import TabFavicon from './TabFavicon.vue'
import TabMoveToMenu from './TabMoveToMenu.vue'

interface Props {
	tab: Tab
	tabsSelected: Set<string>
	windowsMap: Map<number, string>
	loadedGroups: Group[]
	history: HistoryMap
	isCursor?: boolean
	groupColor?: string
}
const props = defineProps<Props>()

const emit = defineEmits<{
	(e: 'toggleSelection', tab: Tab): void
	(e: 'open', tab: Tab): void
	(e: 'close', tab: Tab): void
	(e: 'copy', tab: Tab): void
	(e: 'create-group', payload: { tabs: Tab[] }): void
}>()

const showHistory = ref(false)
const isSelected = computed(() => props.tabsSelected.has(props.tab.stableId))
const actionClass = button({ intent: 'ghost', size: 'xs', square: true })

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
			humanDistance: formatDistanceToNowStrict(new Date(row.visitTime!), { addSuffix: true }),
			dateTime: format(new Date(row.visitTime!), 'MMM d, h:mm a'),
		}))
})
</script>

<template>
	<div
		:class="[
			'group relative rounded-lg border transition-colors',
			isSelected
				? 'border-blue-300 bg-blue-50/80 dark:border-blue-500/40 dark:bg-blue-500/10'
				: 'dark:border-vercel-accents-2 dark:hover:border-vercel-accents-3 border-slate-200 bg-white hover:border-slate-300 dark:bg-black',
			isCursor ? 'ring-2 ring-blue-500 dark:ring-blue-400' : '',
		]"
	>
		<div class="flex items-center gap-3 p-3">
			<input
				type="checkbox"
				class="checkbox"
				:checked="isSelected"
				:aria-label="`Select ${tab.title || tab.url}`"
				@change="emit('toggleSelection', tab)"
			/>
			<span
				class="dark:border-vercel-accents-2 dark:bg-vercel-accents-1 relative flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-slate-50"
			>
				<TabFavicon :src="tab.favIconUrl" :url="tab.url" size="md" />
				<span
					v-if="groupColor"
					class="absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-white dark:ring-black"
					:style="{ backgroundColor: groupColor }"
					aria-hidden="true"
				/>
			</span>
			<button
				type="button"
				class="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
				:title="tab.url"
				@click="emit('open', tab)"
			>
				<span
					class="block truncate text-sm font-medium text-slate-900 group-hover:underline group-hover:decoration-slate-300 group-hover:underline-offset-2 dark:text-white dark:group-hover:decoration-white/30"
				>
					{{ tab.title || 'Untitled' }}
				</span>
				<span
					class="dark:text-vercel-accents-4 mt-0.5 flex items-center gap-1.5 text-xs text-slate-400"
				>
					<MapPinIcon
						v-if="tab.pinned"
						class="size-3 shrink-0 text-amber-500"
						aria-label="Pinned"
					/>
					<SpeakerWaveIcon
						v-if="tab.audible"
						class="size-3 shrink-0"
						aria-label="Playing audio"
					/>
					<span class="truncate">{{ getDisplayUrl(tab.url) }}</span>
				</span>
			</button>
		</div>

		<!-- Hover toolbar -->
		<div
			class="dark:border-vercel-accents-2 absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100 dark:bg-black"
		>
			<button
				type="button"
				:class="[actionClass, showHistory ? 'dark:bg-vercel-accents-2 bg-slate-100' : '']"
				title="Visit history"
				:aria-expanded="showHistory"
				@click="showHistory = !showHistory"
			>
				<ClockIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Visit history</span>
			</button>
			<TabMoveToMenu
				:tabs="[tab]"
				:loaded-groups="loadedGroups"
				:windows-map="windowsMap"
				@on-create-group="(payload) => emit('create-group', payload)"
			>
				<template #button-trigger="{ trigger }">
					<button
						:ref="(el) => trigger(el as HTMLElement)"
						type="button"
						:class="actionClass"
						title="Move to…"
					>
						<ArrowsRightLeftIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Move</span>
					</button>
				</template>
			</TabMoveToMenu>
			<button type="button" :class="actionClass" title="Copy link" @click="emit('copy', tab)">
				<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Copy link</span>
			</button>
			<button
				type="button"
				:class="button({ intent: 'danger-ghost', size: 'xs', square: true })"
				title="Close tab"
				@click="emit('close', tab)"
			>
				<XMarkIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Close tab</span>
			</button>
		</div>

		<!-- Visit history -->
		<div
			v-if="showHistory"
			class="dark:border-vercel-accents-2 border-t border-slate-100 px-3 py-2.5"
		>
			<p class="section-label mb-1.5">Visit history</p>
			<ul v-if="tabHistory.length" class="space-y-1">
				<li
					v-for="historyEvent in tabHistory.slice(0, 5)"
					:key="historyEvent.id"
					class="flex items-center justify-between gap-3 text-xs"
				>
					<span class="dark:text-vercel-accents-6 text-slate-600">
						{{ historyEvent.humanDistance }}
					</span>
					<span class="dark:text-vercel-accents-4 text-slate-400 tabular-nums">
						{{ historyEvent.dateTime }}
					</span>
				</li>
				<li
					v-if="tabHistory.length > 5"
					class="dark:text-vercel-accents-4 pt-0.5 text-xs text-slate-400"
				>
					+{{ tabHistory.length - 5 }} more visits
				</li>
			</ul>
			<p v-else class="dark:text-vercel-accents-4 text-xs text-slate-400">
				No visits recorded.
			</p>
		</div>
	</div>
</template>
