<script setup lang="ts">
import { computed } from 'vue'
import type { KeyHint, KeymapMode } from '@/hooks/useKeymap'
import { isMac } from '@/lib/platform'

const props = withDefaults(
	defineProps<{
		mode: KeymapMode
		pending: string
		cursor: number
		total: number
		/** The cursor is on a group header */
		onHeader?: boolean
		selectedCount: number
		category: string
		whichKey: KeyHint[]
		/** Ctrl is held down */
		ctrl?: boolean
		ctrlHints?: KeyHint[]
		/** Ctrl reaches the list keys (search box focused) */
		ctrlLayer?: boolean
	}>(),
	{
		onHeader: false,
		ctrl: false,
		ctrlHints: () => [],
		ctrlLayer: false,
	},
)

// In the search box a bare x types; outside macOS Ctrl+X stays "cut"
const selectKey = computed(() => (props.mode !== 'search' ? 'x' : isMac ? 'Ctrl-x' : 'Ctrl-Space'))

const modeBadge: Record<KeymapMode, string> = {
	normal: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
	visual: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
	search: 'bg-green-500/10 text-green-700 dark:text-green-400',
}
</script>

<template>
	<div class="fixed inset-x-0 bottom-0 z-40">
		<!-- Which-key: possible completions for a pending key sequence -->
		<div v-if="whichKey.length" class="page-container pb-2">
			<div class="menu-panel ml-auto w-72">
				<div
					v-for="entry in whichKey"
					:key="entry.keys"
					class="flex items-center justify-between gap-3 px-2 py-1"
				>
					<kbd class="kbd px-1.5">{{ entry.keys }}</kbd>
					<span class="dark:text-vercel-accents-6 truncate text-xs text-slate-600">
						{{ entry.description }}
					</span>
				</div>
			</div>
		</div>

		<!-- Holding Ctrl: everything reachable from here -->
		<div v-else-if="ctrlHints.length" class="page-container pb-2">
			<div class="menu-panel ml-auto w-full max-w-xl p-2">
				<p
					class="flex items-center gap-1.5 px-1 pb-1.5 text-xs font-medium text-slate-900 dark:text-white"
				>
					<kbd class="kbd">Ctrl</kbd>
					+
					<span class="dark:text-vercel-accents-5 font-normal text-slate-500">
						{{
							ctrlLayer
								? 'list keys work from the search box while Ctrl is held'
								: 'key'
						}}
					</span>
				</p>
				<div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
					<div
						v-for="entry in ctrlHints"
						:key="entry.keys"
						class="flex min-w-0 items-center gap-2 px-1 py-0.5"
					>
						<kbd class="kbd shrink-0 px-1.5">{{ entry.keys }}</kbd>
						<span class="dark:text-vercel-accents-6 truncate text-xs text-slate-600">
							{{ entry.description }}
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Statusline -->
		<div
			class="dark:border-vercel-accents-2 flex h-9 items-center justify-between border-t border-slate-200 bg-white/95 px-4 font-mono text-xs backdrop-blur dark:bg-black/95"
		>
			<div class="flex items-center gap-3">
				<span class="flex items-center gap-1">
					<span
						class="rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wider"
						:class="modeBadge[mode]"
					>
						{{ mode.toUpperCase() }}
					</span>
					<span
						v-if="ctrl"
						class="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wider text-indigo-600 dark:text-indigo-400"
						aria-live="polite"
					>
						CTRL
					</span>
				</span>
				<span
					v-if="pending"
					class="font-semibold text-slate-900 dark:text-white"
					aria-live="polite"
				>
					{{ pending }}
				</span>
				<span v-if="selectedCount" class="text-blue-600 dark:text-blue-400">
					{{ selectedCount }} selected
				</span>
			</div>
			<div class="dark:text-vercel-accents-5 flex items-center gap-4 text-slate-500">
				<span v-if="onHeader" class="hidden items-center gap-1.5 md:flex">
					<kbd class="kbd px-1.5">Enter</kbd> fold
					<kbd class="kbd ml-1 px-1.5">{{ selectKey }}</kbd> select group
				</span>
				<span
					v-else-if="mode === 'search' && !ctrl"
					class="hidden items-center gap-1.5 md:flex"
				>
					hold <kbd class="kbd px-1.5">Ctrl</kbd> for list keys
				</span>
				<span class="hidden sm:inline">{{ category }}</span>
				<span class="tabular-nums">{{ total ? `${cursor + 1}/${total}` : '0/0' }}</span>
				<span class="hidden items-center gap-1.5 sm:flex">
					<kbd class="kbd">?</kbd>
					help
				</span>
			</div>
		</div>
	</div>
</template>
