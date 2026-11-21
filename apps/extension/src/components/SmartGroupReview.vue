<script setup lang="ts">
/**
 * Smart group's progress and review, shared by the side panel and the Tabs page: while it
 * runs, what it's doing; then the suggested groups to rename, recolor, merge or drop
 * before applying them. The caller starts the suggestion (useSmartGroup) and passes it in.
 * Several root elements, so they space out like the caller's own children.
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { Menu, MenuButton } from '@headlessui/vue'
import { ArrowsPointingInIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/vue/16/solid'
import type { SmartGroup } from '@/hooks/useSmartGroup'
import { pluralize } from '@/lib/format'
import type { Engine } from '@/lib/smartGroup'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const props = defineProps<{ smart: SmartGroup }>()

const {
	review,
	engine,
	fallbackReason,
	running,
	progress,
	leftLoose,
	reviewTabCount,
	modelStatus,
	downloadFraction,
	live,
	mode,
	runningEngine,
	runningNote,
	startedAt,
	opencode,
	suggestAgain,
	cancel,
	dismiss,
	dropGroup,
	dropTab,
	mergeInto,
	cycleColor,
	apply,
	download,
} = props.smart

/** The other ways to group, offered under a suggestion */
const otherEngines = computed(() => {
	const options: { engine: Engine; label: string }[] = []
	if (opencode.value && engine.value !== 'opencode') {
		options.push({ engine: 'opencode', label: `Group with ${opencode.value.model} instead` })
	}
	if (modelStatus.value === 'available' && engine.value !== 'on-device') {
		options.push({ engine: 'on-device', label: 'Group on this device instead' })
	}
	if (engine.value !== 'site') options.push({ engine: 'site', label: 'Group by site instead' })
	return options
})

const expandedKey = ref<number | null>(null)
function toggleExpanded(key: number) {
	expandedKey.value = expandedKey.value === key ? null : key
}

// While it runs, a clock: a slow model and a stuck one shouldn't look the same
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(
	running,
	(on) => {
		clearInterval(ticker)
		if (!on) return
		// A new suggestion starts folded
		expandedKey.value = null
		now.value = Date.now()
		ticker = setInterval(() => (now.value = Date.now()), 1000)
	},
	{ immediate: true },
)
onUnmounted(() => clearInterval(ticker))
const elapsed = computed(() => {
	const seconds = Math.max(0, Math.floor((now.value - startedAt.value) / 1000))
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

/** What the engine really at work is doing (the one set up may have failed) */
const runningLine = computed(() => {
	if (runningEngine.value === 'opencode')
		return `Grouping by topic with ${opencode.value?.model ?? 'your model'} (opencode)…`
	if (runningEngine.value === 'on-device') return 'Grouping by topic on this device…'
	if (runningEngine.value === 'site') return 'Grouping by site…'
	return 'Getting ready…'
})

const percent = (fraction: number) => Math.round(fraction * 100)
const groupingPercent = computed(() =>
	progress.value.total ? percent(progress.value.done / progress.value.total) : 0,
)
/** opencode proposes groups one tool call at a time, so each shows as it lands */
const viaTools = computed(() => runningEngine.value === 'opencode' && !!opencode.value?.folder)

const COLOR_DOT: Record<string, string> = {
	grey: 'bg-slate-400',
	blue: 'bg-blue-500',
	red: 'bg-red-500',
	yellow: 'bg-yellow-500',
	green: 'bg-green-500',
	pink: 'bg-pink-500',
	purple: 'bg-purple-500',
	cyan: 'bg-cyan-500',
	orange: 'bg-orange-500',
}
const dot = (color: string) => COLOR_DOT[color] ?? COLOR_DOT.grey
</script>

<template>
	<div v-if="running" class="card space-y-2 p-3 text-xs" role="status">
		<div class="flex items-center justify-between gap-2">
			<!-- With tool calls, the line shows each group as the model proposes it -->
			<span v-if="live" class="min-w-0 truncate">
				<span class="font-medium text-slate-900 dark:text-white">{{ live.name }}</span>
				· {{ pluralize(live.tabs, 'tab') }}
			</span>
			<span v-else class="min-w-0 truncate">{{ runningLine }}</span>
			<span class="flex shrink-0 items-center gap-3">
				<span v-if="live" class="dark:text-vercel-accents-5 tabular-nums text-slate-500">
					{{ pluralize(live.count, 'group') }}
				</span>
				<span
					class="dark:text-vercel-accents-5 tabular-nums text-slate-500"
					:title="`Running for ${elapsed}`"
				>
					{{ elapsed }}
				</span>
				<button
					type="button"
					class="dark:text-vercel-accents-5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
					@click="cancel"
				>
					Stop
				</button>
			</span>
		</div>
		<!-- The engine set up failed and the next one took over: say so now, not after -->
		<p v-if="runningNote" class="text-amber-700 dark:text-amber-300">
			{{ runningNote }}. Grouping
			{{ runningEngine === 'on-device' ? 'on this device' : 'by site' }} instead.
		</p>
		<p v-if="opencode && viaTools" class="dark:text-vercel-accents-5 text-slate-500">
			{{
				live
					? `${opencode.model} is proposing groups…`
					: `${opencode.model} is reading ${pluralize(progress.total, 'tab')}. Each group shows up here as it's proposed.`
			}}
		</p>
		<template v-else-if="runningEngine && runningEngine !== 'site'">
			<div class="dark:bg-vercel-accents-2 h-1 overflow-hidden rounded-full bg-slate-100">
				<div
					class="bg-papaya-900 h-full transition-[width]"
					:style="{ width: `${groupingPercent}%` }"
				/>
			</div>
			<p class="dark:text-vercel-accents-5 tabular-nums text-slate-500">
				{{ progress.done }} of {{ pluralize(progress.total, 'tab') }}
			</p>
		</template>
	</div>

	<template v-if="review.length && !running">
		<p class="dark:text-vercel-accents-5 text-xs text-slate-500">
			<template v-if="engine === 'opencode'">
				Grouped by topic with {{ opencode?.model ?? 'your model' }} through opencode.
			</template>
			<template v-else-if="engine === 'on-device'">
				Grouped by topic with Chrome's on-device model.
			</template>
			<template v-else>Grouped by site.</template>
			Rename, merge or drop groups, then apply. Nothing closes.
			<template v-if="mode === 'all'">
				Applying takes these tabs out of the groups they're in; Undo brings those groups
				back.
			</template>
		</p>
		<ul
			role="list"
			class="card dark:divide-vercel-accents-2 divide-y divide-slate-100"
			aria-label="Suggested groups"
		>
			<li v-for="group in review" :key="group.key">
				<div class="flex items-center gap-1.5 py-1.5 pl-1.5 pr-1.5">
					<button
						type="button"
						class="dark:hover:bg-vercel-accents-2 flex size-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
						:title="`Color: ${group.color}. Click to change.`"
						@click="cycleColor(group.key)"
					>
						<span class="size-2.5 rounded-full" :class="dot(group.color)" />
						<span class="sr-only">Change color</span>
					</button>
					<input
						v-model="group.name"
						class="min-w-0 flex-1 truncate rounded border-0 bg-transparent p-0 text-sm font-medium focus:outline-none focus:ring-0"
						aria-label="Group name"
						maxlength="40"
					/>
					<button
						type="button"
						class="dark:text-vercel-accents-5 flex shrink-0 items-center gap-0.5 rounded px-1 text-xs tabular-nums text-slate-500 hover:text-slate-900 dark:hover:text-white"
						:aria-expanded="expandedKey === group.key"
						:title="expandedKey === group.key ? 'Hide tabs' : 'Show tabs'"
						@click="toggleExpanded(group.key)"
					>
						{{ group.tabs.length }}
						<ChevronDownIcon
							class="size-3 transition-transform"
							:class="expandedKey === group.key ? 'rotate-180' : ''"
							aria-hidden="true"
						/>
					</button>
					<Menu v-if="review.length > 1" as="div" class="relative">
						<MenuButton
							:class="button({ intent: 'ghost', size: 'xs', square: true })"
							title="Merge into another group"
						>
							<ArrowsPointingInIcon class="size-3.5" aria-hidden="true" />
							<span class="sr-only">Merge into another group</span>
						</MenuButton>
						<AppMenuItems width="w-48">
							<div class="menu-heading">Merge into</div>
							<AppMenuItem
								v-for="other in review.filter((g) => g.key !== group.key)"
								:key="other.key"
								@click="mergeInto(group.key, other.key)"
							>
								<template #leading>
									<span
										class="size-2 shrink-0 rounded-full"
										:class="dot(other.color)"
									/>
								</template>
								{{ other.name || 'Unnamed' }}
							</AppMenuItem>
						</AppMenuItems>
					</Menu>
					<AppButton
						intent="ghost"
						size="xs"
						square
						title="Drop this group (its tabs stay loose)"
						@click="dropGroup(group.key)"
					>
						<XMarkIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Drop group</span>
					</AppButton>
				</div>
				<ul
					v-if="expandedKey === group.key"
					role="list"
					class="max-h-60 overflow-y-auto pb-1.5 pl-8 pr-1.5"
				>
					<li
						v-for="tab in group.tabs"
						:key="tab.id"
						class="group/tab flex items-center gap-2"
					>
						<TabFavicon :src="tab.favIconUrl" :url="tab.url" />
						<span class="min-w-0 flex-1 truncate text-xs" :title="tab.url">
							{{ tab.title || tab.url }}
						</span>
						<AppButton
							intent="ghost"
							size="xs"
							square
							class="opacity-0 focus-visible:opacity-100 group-hover/tab:opacity-100"
							title="Leave this tab loose"
							@click="dropTab(group.key, tab.id)"
						>
							<XMarkIcon class="size-3" aria-hidden="true" />
							<span class="sr-only">Leave this tab loose</span>
						</AppButton>
					</li>
				</ul>
			</li>
		</ul>
		<p v-if="leftLoose" class="dark:text-vercel-accents-5 text-xs text-slate-500">
			{{ pluralize(leftLoose, 'tab') }} {{ leftLoose === 1 ? 'fits' : 'fit' }} no group and
			{{ mode === 'all' ? 'will be loose' : leftLoose === 1 ? 'stays loose' : 'stay loose' }}.
		</p>
		<p v-if="fallbackReason" class="text-xs text-amber-700 dark:text-amber-300">
			{{ fallbackReason }}. So these are grouped
			{{ engine === 'on-device' ? 'on this device' : 'by site' }} instead.
		</p>
		<div class="flex gap-2">
			<AppButton intent="primary" size="sm" class="flex-1" @click="apply">
				{{ mode === 'all' ? 'Regroup' : 'Group' }}
				{{ pluralize(reviewTabCount, 'tab') }}
			</AppButton>
			<AppButton size="sm" @click="dismiss">Cancel</AppButton>
		</div>
		<div class="flex flex-wrap gap-x-3 gap-y-1">
			<button
				v-for="other in otherEngines"
				:key="other.engine"
				type="button"
				class="dark:text-vercel-accents-5 text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline dark:hover:text-white"
				@click="suggestAgain(other.engine)"
			>
				{{ other.label }}
			</button>
		</div>
	</template>

	<p
		v-if="
			!running &&
			(modelStatus === 'downloadable' ||
				modelStatus === 'downloading' ||
				downloadFraction !== null)
		"
		class="dark:text-vercel-accents-5 text-xs text-slate-500"
	>
		<template v-if="downloadFraction !== null">
			Downloading Chrome's on-device model…
			<span class="tabular-nums">{{ percent(downloadFraction) }}%</span>
		</template>
		<template v-else-if="modelStatus === 'downloading'">
			Chrome is downloading its on-device model. Until it's ready, Smart group groups by site.
		</template>
		<template v-else>
			To group by topic instead of by site, Chrome can download its on-device model (a
			one-time download of a few GB).
			<button
				type="button"
				class="font-medium text-slate-900 underline underline-offset-2 dark:text-white"
				@click="download"
			>
				Download
			</button>
		</template>
	</p>
</template>
