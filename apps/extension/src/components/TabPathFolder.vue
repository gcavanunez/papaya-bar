<script setup lang="ts">
/**
 * A folder of a site's tabs by address path (github.com/gcavanunez/…), in the tab
 * manager's list view by site: folds like a group header, one indent per level.
 */
import {
	ArrowsRightLeftIcon,
	ChevronRightIcon,
	DocumentDuplicateIcon,
	FolderIcon,
	FolderOpenIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import type { Group, Tab, WindowsMap } from '@/types'
import { pluralize } from '@/lib/format'
import { button } from '@/lib/ui'
import TabMoveToMenu from './TabMoveToMenu.vue'

defineProps<{
	/** What the folder adds to its parent's path, e.g. "gcavanunez/papaya-bar" */
	label: string
	/** The whole place, e.g. "github.com/gcavanunez/papaya-bar" */
	place: string
	/** Every tab in the folder and its subfolders */
	tabs: Tab[]
	depth: number
	collapsed: boolean
	selection: 'none' | 'some' | 'all'
	isCursor: boolean
	windowsMap: WindowsMap
	loadedGroups: Group[]
}>()

const emit = defineEmits<{
	(e: 'focus'): void
	(e: 'toggle-collapse'): void
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
			'group/folder dark:border-vercel-accents-2/60 relative flex h-9 items-center gap-3 border-b border-slate-100 pr-2',
			isCursor
				? 'dark:bg-vercel-accents-1 bg-slate-50'
				: 'dark:hover:bg-vercel-accents-1 hover:bg-slate-50',
		]"
		:style="{ paddingLeft: `${16 + depth * 20}px` }"
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
			:aria-label="`Select all tabs in ${place}`"
			@click.stop
			@change="emit('toggle-select')"
		/>

		<button
			type="button"
			class="flex h-full min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
			:aria-expanded="!collapsed"
			:title="place"
			@click="emit('toggle-collapse')"
		>
			<ChevronRightIcon
				:class="[
					'dark:text-vercel-accents-5 size-3.5 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none',
					collapsed ? '' : 'rotate-90',
				]"
				aria-hidden="true"
			/>
			<component
				:is="collapsed ? FolderIcon : FolderOpenIcon"
				class="dark:text-vercel-accents-5 size-4 shrink-0 text-slate-400"
				aria-hidden="true"
			/>
			<span class="truncate font-mono text-xs text-slate-700 dark:text-slate-200">
				{{ label }}/
			</span>
			<span
				class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 shrink-0 rounded-full bg-slate-200/70 px-1.5 py-px text-[11px] font-medium tabular-nums text-slate-600"
			>
				{{ tabs.length }}
			</span>
		</button>

		<div
			:class="[
				'flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 has-[[data-headlessui-state~=open]]:opacity-100',
				isCursor ? 'opacity-100' : 'opacity-0',
			]"
			@click.stop
		>
			<TabMoveToMenu
				:tabs="tabs"
				:windows-map="windowsMap"
				:loaded-groups="loadedGroups"
				@on-create-group="(payload) => emit('create-group', payload)"
			>
				<template #button-trigger>
					<button
						type="button"
						:class="actionClass"
						:title="`Move ${pluralize(tabs.length, 'tab')}…`"
					>
						<ArrowsRightLeftIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Move tabs</span>
					</button>
				</template>
			</TabMoveToMenu>
			<button type="button" :class="actionClass" title="Copy links" @click="emit('copy')">
				<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Copy links</span>
			</button>
			<button
				type="button"
				:class="button({ intent: 'danger-ghost', size: 'xs', square: true })"
				:title="`Close ${pluralize(tabs.length, 'tab')}`"
				@click="emit('close')"
			>
				<XMarkIcon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Close tabs</span>
			</button>
		</div>
	</div>
</template>
