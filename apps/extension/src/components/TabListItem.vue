<script setup lang="ts">
import {
	DocumentDuplicateIcon,
	MapPinIcon,
	SpeakerWaveIcon,
	XMarkIcon,
	ArrowsRightLeftIcon,
} from '@heroicons/vue/16/solid'
import type { Group, Tab, WindowsMap } from '@/types'
import { getDisplayUrl } from '@/lib/format'
import { button } from '@/lib/ui'
import TabFavicon from './TabFavicon.vue'
import TabMoveToMenu from './TabMoveToMenu.vue'

defineProps<{
	tab: Tab
	isCursor: boolean
	isSelected: boolean
	isDuplicate: boolean
	windowsMap: WindowsMap
	loadedGroups: Group[]
	/** Tab-group chip; omitted when the list is already grouped by tab group */
	groupChip?: { title: string; color: string } | null
}>()

const emit = defineEmits<{
	(e: 'focus'): void
	(e: 'open'): void
	(e: 'toggle-select'): void
	(e: 'copy'): void
	(e: 'close'): void
	(e: 'create-group', payload: { tabs: Tab[] }): void
}>()

const actionClass = button({ intent: 'ghost', size: 'xs', square: true })
</script>

<template>
	<div
		:class="[
			'group relative flex h-11 items-center gap-3 border-b pr-2 pl-4 transition-colors',
			'dark:border-vercel-accents-2/60 border-slate-100',
			isSelected
				? 'bg-blue-50/80 dark:bg-blue-500/10'
				: isCursor
					? 'dark:bg-vercel-accents-1 bg-slate-50'
					: 'dark:hover:bg-vercel-accents-1 hover:bg-slate-50',
		]"
		@click="emit('focus')"
	>
		<span
			v-if="isCursor"
			class="absolute inset-y-0 left-0 w-0.5 bg-blue-500 dark:bg-blue-400"
			aria-hidden="true"
		/>
		<input
			type="checkbox"
			class="checkbox"
			:checked="isSelected"
			:aria-label="`Select ${tab.title || tab.url}`"
			@click.stop
			@change="emit('toggle-select')"
		/>
		<TabFavicon :src="tab.favIconUrl" :url="tab.url" />

		<button
			type="button"
			class="flex min-w-0 flex-1 items-baseline gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
			:title="tab.url"
			@click.stop="emit('open')"
		>
			<span
				class="min-w-0 shrink truncate text-sm font-medium text-slate-900 group-hover:underline group-hover:decoration-slate-300 group-hover:underline-offset-2 dark:text-white dark:group-hover:decoration-white/30"
			>
				{{ tab.title || 'Untitled' }}
			</span>
			<span
				class="dark:text-vercel-accents-4 min-w-24 flex-1 truncate text-xs text-slate-400"
			>
				{{ getDisplayUrl(tab.url) }}
			</span>
		</button>

		<div class="flex shrink-0 items-center gap-1.5">
			<span
				v-if="isDuplicate"
				class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
			>
				Duplicate
			</span>
			<span
				v-if="groupChip"
				class="dark:border-vercel-accents-2 dark:text-vercel-accents-6 inline-flex max-w-32 items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600"
			>
				<span
					class="size-1.5 shrink-0 rounded-full"
					:style="{ backgroundColor: groupChip.color }"
				/>
				<span class="truncate">{{ groupChip.title }}</span>
			</span>
			<SpeakerWaveIcon
				v-if="tab.audible"
				class="size-3.5 text-slate-400"
				aria-label="Playing audio"
			/>
			<MapPinIcon v-if="tab.pinned" class="size-3.5 text-amber-500" aria-label="Pinned" />
		</div>

		<div
			:class="[
				'flex shrink-0 items-center gap-0.5 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
				isCursor ? 'opacity-100' : 'opacity-0',
			]"
			@click.stop
		>
			<TabMoveToMenu
				:tabs="[tab]"
				:windows-map="windowsMap"
				:loaded-groups="loadedGroups"
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
			<button type="button" :class="actionClass" title="Copy link (yy)" @click="emit('copy')">
				<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Copy link</span>
			</button>
			<button
				type="button"
				:class="button({ intent: 'danger-ghost', size: 'xs', square: true })"
				title="Close tab (Backspace)"
				@click="emit('close')"
			>
				<XMarkIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Close tab</span>
			</button>
		</div>
	</div>
</template>
