<script setup lang="ts">
import {
	ArrowsRightLeftIcon,
	ChevronRightIcon,
	ClockIcon,
	DocumentDuplicateIcon,
	GlobeAltIcon,
	PencilIcon,
	TagIcon,
	WindowIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import type { Group, Tab, TabGroupBy, TabSection, WindowsMap } from '@/types'
import { pluralize } from '@/lib/format'
import { button } from '@/lib/ui'
import TabFavicon from './TabFavicon.vue'
import TabMoveToMenu from './TabMoveToMenu.vue'

defineProps<{
	section: TabSection
	groupBy: TabGroupBy
	collapsed: boolean
	selection: 'none' | 'some' | 'all'
	canEdit: boolean
	/** The keyboard cursor is on this header */
	isCursor?: boolean
	windowsMap: WindowsMap
	loadedGroups: Group[]
}>()

const emit = defineEmits<{
	(e: 'focus'): void
	(e: 'toggle-collapse'): void
	(e: 'toggle-select'): void
	(e: 'copy'): void
	(e: 'close'): void
	(e: 'edit'): void
	(e: 'create-group', payload: { tabs: Tab[] }): void
}>()

const actionClass = button({ intent: 'ghost', size: 'xs', square: true })
const iconClass = 'dark:text-vercel-accents-5 size-4 shrink-0 text-slate-400'
</script>

<template>
	<div
		:class="[
			'group/header dark:border-vercel-accents-2 relative flex h-10 items-center gap-3 border-b border-slate-200 pr-2 pl-4',
			isCursor
				? 'dark:bg-vercel-accents-2 bg-slate-100'
				: 'dark:bg-vercel-accents-1 bg-slate-50',
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
			:checked="selection === 'all'"
			:indeterminate="selection === 'some'"
			:aria-label="`Select all tabs in ${section.label}`"
			@change="emit('toggle-select')"
		/>

		<button
			type="button"
			class="flex h-full min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
			:aria-expanded="!collapsed"
			@click="emit('toggle-collapse')"
		>
			<template v-if="groupBy === 'site'">
				<GlobeAltIcon v-if="section.isOther" :class="iconClass" aria-hidden="true" />
				<TabFavicon v-else :src="section.favIconUrl" :url="section.url" />
			</template>
			<template v-else-if="groupBy === 'group'">
				<span
					v-if="section.color"
					class="flex size-4 shrink-0 items-center justify-center"
					aria-hidden="true"
				>
					<span
						class="size-2.5 rounded-full"
						:style="{ backgroundColor: section.color }"
					/>
				</span>
				<TagIcon v-else :class="iconClass" aria-hidden="true" />
			</template>
			<WindowIcon v-else-if="groupBy === 'window'" :class="iconClass" aria-hidden="true" />
			<ClockIcon v-else :class="iconClass" aria-hidden="true" />

			<span class="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
				{{ section.label }}
			</span>
			<span
				class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 shrink-0 rounded-full bg-slate-200/70 px-1.5 py-px text-[11px] font-medium text-slate-600 tabular-nums"
			>
				{{ section.tabs.length }}
			</span>
		</button>

		<div
			:class="[
				'flex shrink-0 items-center gap-0.5 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100',
				isCursor ? 'opacity-100' : 'opacity-0',
			]"
		>
			<button
				v-if="canEdit"
				type="button"
				:class="actionClass"
				title="Edit tab group"
				@click="emit('edit')"
			>
				<PencilIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Edit tab group</span>
			</button>
			<TabMoveToMenu
				:tabs="section.tabs"
				:windows-map="windowsMap"
				:loaded-groups="loadedGroups"
				@on-create-group="(payload) => emit('create-group', payload)"
			>
				<template #button-trigger="{ trigger }">
					<button
						:ref="(el) => trigger(el as HTMLElement)"
						type="button"
						:class="actionClass"
						:title="`Move ${pluralize(section.tabs.length, 'tab')}…`"
					>
						<ArrowsRightLeftIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Move tabs</span>
					</button>
				</template>
			</TabMoveToMenu>
			<button
				type="button"
				:class="actionClass"
				title="Copy links (yy)"
				@click="emit('copy')"
			>
				<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Copy links</span>
			</button>
			<button
				type="button"
				:class="button({ intent: 'danger-ghost', size: 'xs', square: true })"
				:title="`Close ${pluralize(section.tabs.length, 'tab')} (dd)`"
				@click="emit('close')"
			>
				<XMarkIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Close tabs</span>
			</button>
		</div>

		<button
			type="button"
			:class="actionClass"
			:title="collapsed ? 'Expand (Enter or za)' : 'Collapse (Enter or za)'"
			@click="emit('toggle-collapse')"
		>
			<ChevronRightIcon
				:class="['size-4 transition-transform duration-150', collapsed ? '' : 'rotate-90']"
				aria-hidden="true"
			/>
			<span class="sr-only">{{ collapsed ? 'Expand group' : 'Collapse group' }}</span>
		</button>
	</div>
</template>
