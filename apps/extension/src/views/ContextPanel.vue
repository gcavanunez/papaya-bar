<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useContexts } from '@/hooks/useContexts'
import { useOpenGroups } from '@/hooks/useOpenGroups'
import { useSmartGroup } from '@/hooks/useSmartGroup'
import {
	ArchiveBoxArrowDownIcon,
	ArrowsPointingInIcon,
	ArrowUturnLeftIcon,
	ChevronDownIcon,
	EllipsisHorizontalIcon,
	InboxIcon,
	PencilIcon,
	PlusIcon,
	RectangleStackIcon,
	SparklesIcon,
	TrashIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import { Menu, MenuButton } from '@headlessui/vue'
import { button } from '@/lib/ui'
import { pluralize } from '@/lib/format'
import { AUTO_PARK_DAYS } from '@/lib/swapEngine'
import type { Engine } from '@/lib/smartGroup'
import { focusGroup } from '@/lib/tabGroups'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import EmptyState from '@/components/EmptyState.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const {
	activeContext,
	switchableContexts,
	liveStats,
	resume,
	stashActive,
	createFromLive,
	parkStaleTabs,
	rename,
	archive,
	remove,
	refresh,
	refreshLiveStats,
} = useContexts()
const { groups: openGroups, looseTabs, focusedGroupId, windowNumbers } = useOpenGroups()
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
	refreshModelStatus,
	suggest,
	cancel,
	dismiss,
	dropGroup,
	dropTab,
	mergeInto,
	cycleColor,
	apply,
	download,
} = useSmartGroup()

const autoPark = ref(false)
const search = ref('')

const visibleGroups = computed(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return openGroups.value
	return openGroups.value.filter((g) => g.title.toLowerCase().includes(q))
})

function smartGroup(preferred: Engine | 'auto' = 'auto') {
	expandedKey.value = null
	void suggest(looseTabs.value, {
		engine: preferred,
		usedColors: openGroups.value.map((g) => g.color),
	})
}

const expandedKey = ref<number | null>(null)
function toggleExpanded(key: number) {
	expandedKey.value = expandedKey.value === key ? null : key
}

const percent = (fraction: number) => Math.round(fraction * 100)
const groupingPercent = computed(() =>
	progress.value.total ? percent(progress.value.done / progress.value.total) : 0,
)

async function loadAutoPark() {
	const stored = await chrome.storage.local.get('papaya:autoPark')
	autoPark.value = !!(stored['papaya:autoPark'] as { enabled?: boolean } | undefined)?.enabled
}
async function toggleAutoPark() {
	autoPark.value = !autoPark.value
	await chrome.storage.local.set({
		'papaya:autoPark': { enabled: autoPark.value, days: AUTO_PARK_DAYS },
	})
}
async function parkNow() {
	await parkStaleTabs(AUTO_PARK_DAYS)
	void refreshLiveStats()
}
const showNew = ref(false)
const newName = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')

const filtered = computed(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return switchableContexts.value
	return switchableContexts.value.filter((c) => c.name.toLowerCase().includes(q))
})

// Tailwind classes for the chrome tab-group color palette.
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

const showNudge = computed(() => liveStats.value.total >= 15 || liveStats.value.stale > 0)

async function onCreate() {
	const name = newName.value.trim()
	if (!name) return
	await createFromLive(name, { activate: true })
	newName.value = ''
	showNew.value = false
}

function startRename(id: string, current: string) {
	editingId.value = id
	editingName.value = current
}
function commitRename() {
	if (editingId.value && editingName.value.trim()) {
		rename(editingId.value, editingName.value.trim())
	}
	editingId.value = null
}

function relativeTime(ts: number): string {
	const diff = Date.now() - ts
	const mins = Math.round(diff / 60000)
	if (mins < 1) return 'just now'
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.round(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	return `${Math.round(hrs / 24)}d ago`
}

// Keep live tab stats fresh while the panel is open.
function onTabsChanged() {
	void refreshLiveStats()
	refresh()
}

onMounted(() => {
	void loadAutoPark()
	void refreshModelStatus()
	chrome.tabs.onCreated.addListener(onTabsChanged)
	chrome.tabs.onRemoved.addListener(onTabsChanged)
	chrome.tabs.onUpdated.addListener(onTabsChanged)
	chrome.tabs.onActivated.addListener(onTabsChanged)
})
onUnmounted(() => {
	chrome.tabs.onCreated.removeListener(onTabsChanged)
	chrome.tabs.onRemoved.removeListener(onTabsChanged)
	chrome.tabs.onUpdated.removeListener(onTabsChanged)
	chrome.tabs.onActivated.removeListener(onTabsChanged)
})
</script>

<template>
	<div
		class="dark:bg-vercel-accents-1 flex h-screen flex-col bg-slate-50 text-slate-900 antialiased dark:text-white"
	>
		<!-- Header -->
		<header
			class="dark:border-vercel-accents-2 shrink-0 space-y-3 border-b border-slate-200 bg-white px-4 py-3 dark:bg-black"
		>
			<div class="flex items-center justify-between">
				<h1 class="text-sm font-semibold">Groups &amp; contexts</h1>
				<span class="dark:text-vercel-accents-5 text-xs text-slate-500 tabular-nums">
					{{ pluralize(liveStats.total, 'live tab') }}
				</span>
			</div>
			<SearchInput v-model="search" size="sm" placeholder="Search groups and contexts…" />
		</header>

		<div class="flex-1 space-y-4 overflow-y-auto p-4">
			<!-- Active context / Inbox card -->
			<section class="card p-3">
				<template v-if="activeContext">
					<div class="flex items-center gap-2">
						<span
							class="size-2.5 shrink-0 rounded-full"
							:class="dot(activeContext.color)"
						/>
						<span class="truncate text-sm font-medium">{{ activeContext.name }}</span>
						<span
							class="ml-auto rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400"
						>
							Active
						</span>
					</div>
					<p class="dark:text-vercel-accents-5 mt-1 text-xs text-slate-500">
						{{ pluralize(liveStats.total, 'tab') }} open
					</p>
					<AppButton intent="primary" size="sm" class="mt-3 w-full" @click="stashActive">
						<ArchiveBoxArrowDownIcon class="size-3.5" aria-hidden="true" />
						Stash &amp; clear
					</AppButton>
				</template>

				<template v-else>
					<div class="flex items-center gap-2">
						<InboxIcon class="dark:text-vercel-accents-5 size-4 text-slate-400" />
						<span class="text-sm font-medium">Inbox</span>
						<span
							class="dark:text-vercel-accents-5 ml-auto text-xs text-slate-500 tabular-nums"
						>
							{{ liveStats.total }} unsorted
						</span>
					</div>
					<p class="dark:text-vercel-accents-5 mt-1 text-xs text-slate-500">
						Your live tabs aren't in a context yet.
					</p>
					<form v-if="showNew" class="mt-3 flex gap-2" @submit.prevent="onCreate">
						<input
							v-model="newName"
							autofocus
							placeholder="Context name…"
							class="field h-7 min-w-0 flex-1 px-2"
							@keyup.esc="showNew = false"
						/>
						<AppButton intent="primary" size="sm" type="submit">Save</AppButton>
					</form>
					<AppButton
						v-else
						intent="primary"
						size="sm"
						class="mt-3 w-full"
						:disabled="liveStats.total === 0"
						@click="showNew = true"
					>
						<PlusIcon class="size-3.5" aria-hidden="true" />
						Save current tabs as context
					</AppButton>
				</template>
			</section>

			<!-- Open groups: Chrome's tab groups. Clicking one focuses it and folds the rest. -->
			<section v-if="visibleGroups.length">
				<p class="section-label mb-2">Open groups · {{ visibleGroups.length }}</p>
				<ul
					role="list"
					class="card dark:divide-vercel-accents-2 divide-y divide-slate-100 overflow-hidden"
				>
					<li v-for="group in visibleGroups" :key="group.id">
						<button
							type="button"
							class="dark:hover:bg-vercel-accents-1 relative flex w-full items-center gap-2.5 py-2 pr-3 pl-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
							:class="
								group.id === focusedGroupId
									? 'dark:bg-vercel-accents-1 bg-slate-50'
									: ''
							"
							:aria-current="group.id === focusedGroupId ? 'true' : undefined"
							:title="`Go to ${group.title || 'this group'} and fold the other groups`"
							@click="focusGroup(group.id)"
						>
							<span
								v-if="group.id === focusedGroupId"
								class="bg-papaya-900 absolute inset-y-1.5 left-0 w-0.5 rounded-full"
								aria-hidden="true"
							/>
							<span
								class="size-2.5 shrink-0 rounded-full"
								:class="dot(group.color)"
							/>
							<span
								class="min-w-0 flex-1 truncate text-sm"
								:class="
									group.title
										? 'font-medium'
										: 'dark:text-vercel-accents-5 text-slate-500 italic'
								"
							>
								{{ group.title || 'Unnamed group' }}
							</span>
							<span
								v-if="windowNumbers"
								class="dark:text-vercel-accents-5 text-[11px] text-slate-400"
								:title="`Window ${windowNumbers.get(group.windowId)}`"
							>
								W{{ windowNumbers.get(group.windowId) }}
							</span>
							<span
								class="dark:text-vercel-accents-5 text-xs text-slate-500 tabular-nums"
							>
								{{ group.tabIds.length }}
							</span>
						</button>
					</li>
				</ul>
			</section>

			<!-- Loose tabs and smart grouping. Applying creates tab groups; nothing closes. -->
			<section v-if="looseTabs.length || review.length || running" class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<p class="section-label">Loose tabs · {{ looseTabs.length }}</p>
					<AppButton
						v-if="!review.length"
						size="xs"
						:disabled="looseTabs.length < 2 || running"
						title="Suggest groups for these tabs. You review them before anything changes."
						@click="smartGroup()"
					>
						<SparklesIcon class="size-3.5" aria-hidden="true" />
						Smart group
					</AppButton>
				</div>

				<div v-if="running" class="card space-y-2 p-3 text-xs" role="status">
					<div class="flex items-center justify-between gap-2">
						<span>
							{{
								modelStatus === 'available'
									? 'Grouping by topic on this device…'
									: 'Grouping…'
							}}
						</span>
						<button
							type="button"
							class="dark:text-vercel-accents-5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
							@click="cancel"
						>
							Stop
						</button>
					</div>
					<div
						class="dark:bg-vercel-accents-2 h-1 overflow-hidden rounded-full bg-slate-100"
					>
						<div
							class="bg-papaya-900 h-full transition-[width]"
							:style="{ width: `${groupingPercent}%` }"
						/>
					</div>
					<p class="dark:text-vercel-accents-5 text-slate-500 tabular-nums">
						{{ progress.done }} of {{ pluralize(progress.total, 'tab') }}
					</p>
				</div>

				<template v-if="review.length && !running">
					<p class="dark:text-vercel-accents-5 text-xs text-slate-500">
						<template v-if="engine === 'on-device'">
							Grouped by topic with Chrome's on-device model.
						</template>
						<template v-else>Grouped by site.</template>
						Rename, merge or drop groups, then apply. Nothing closes.
					</p>
					<ul
						role="list"
						class="card dark:divide-vercel-accents-2 divide-y divide-slate-100"
						aria-label="Suggested groups"
					>
						<li v-for="group in review" :key="group.key">
							<div class="flex items-center gap-1.5 py-1.5 pr-1.5 pl-1.5">
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
									class="min-w-0 flex-1 truncate rounded border-0 bg-transparent p-0 text-sm font-medium focus:ring-0 focus:outline-none"
									aria-label="Group name"
									maxlength="40"
								/>
								<button
									type="button"
									class="dark:text-vercel-accents-5 flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-slate-500 tabular-nums hover:text-slate-900 dark:hover:text-white"
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
										:class="
											button({ intent: 'ghost', size: 'xs', square: true })
										"
										title="Merge into another group"
									>
										<ArrowsPointingInIcon class="size-3.5" aria-hidden="true" />
										<span class="sr-only">Merge into another group</span>
									</MenuButton>
									<AppMenuItems width="w-48">
										<div class="menu-heading">Merge into</div>
										<AppMenuItem
											v-for="other in review.filter(
												(g) => g.key !== group.key,
											)"
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
								class="max-h-60 overflow-y-auto pr-1.5 pb-1.5 pl-8"
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
										class="opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
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
						{{ pluralize(leftLoose, 'tab') }} fit no group and stay loose.
					</p>
					<p v-if="fallbackReason" class="text-xs text-amber-700 dark:text-amber-300">
						The on-device model failed ({{ fallbackReason }}), so these are grouped by
						site.
					</p>
					<div class="flex gap-2">
						<AppButton intent="primary" size="sm" class="flex-1" @click="apply">
							Group {{ pluralize(reviewTabCount, 'tab') }}
						</AppButton>
						<AppButton size="sm" @click="dismiss">Cancel</AppButton>
					</div>
					<button
						v-if="engine === 'on-device'"
						type="button"
						class="dark:text-vercel-accents-5 text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline dark:hover:text-white"
						@click="smartGroup('site')"
					>
						Group by site instead
					</button>
					<button
						v-else-if="modelStatus === 'available'"
						type="button"
						class="dark:text-vercel-accents-5 text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline dark:hover:text-white"
						@click="smartGroup('on-device')"
					>
						Group by topic instead
					</button>
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
						Chrome is downloading its on-device model. Until it's ready, Smart group
						groups by site.
					</template>
					<template v-else>
						To group by topic instead of by site, Chrome can download its on-device
						model (a one-time download of a few GB).
						<button
							type="button"
							class="font-medium text-slate-900 underline underline-offset-2 dark:text-white"
							@click="download"
						>
							Download
						</button>
					</template>
				</p>
			</section>

			<!-- Nudge -->
			<div
				v-if="showNudge"
				class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
			>
				<div class="flex items-center justify-between gap-2">
					<span>
						{{ pluralize(liveStats.total, 'tab') }} open<template
							v-if="liveStats.stale > 0"
						>
							· {{ liveStats.stale }} untouched {{ AUTO_PARK_DAYS }}d+</template
						>
					</span>
					<button
						v-if="liveStats.stale > 0"
						type="button"
						class="shrink-0 rounded bg-amber-200 px-2 py-1 font-medium text-amber-900 hover:bg-amber-300 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30"
						@click="parkNow"
					>
						Park {{ liveStats.stale }}
					</button>
				</div>
				<label class="mt-2 flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						:checked="autoPark"
						class="checkbox size-3.5"
						@change="toggleAutoPark"
					/>
					Auto-park tabs untouched {{ AUTO_PARK_DAYS }}d+
				</label>
			</div>

			<!-- Switcher list -->
			<section v-if="filtered.length">
				<p class="section-label mb-2">Contexts</p>
				<ul role="list" class="card dark:divide-vercel-accents-2 divide-y divide-slate-100">
					<li v-for="ctx in filtered" :key="ctx.id">
						<div
							class="group dark:hover:bg-vercel-accents-1 flex items-center gap-2.5 py-2 pr-1.5 pl-3 hover:bg-slate-50"
						>
							<span class="size-2.5 shrink-0 rounded-full" :class="dot(ctx.color)" />

							<template v-if="editingId === ctx.id">
								<input
									v-model="editingName"
									autofocus
									class="field h-7 min-w-0 flex-1 px-2"
									@keyup.enter="commitRename"
									@keyup.esc="editingId = null"
									@blur="commitRename"
								/>
							</template>
							<template v-else>
								<button
									type="button"
									class="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-blue-500"
									@click="resume(ctx.id)"
								>
									<span class="block truncate text-sm font-medium">{{
										ctx.name
									}}</span>
									<span
										class="dark:text-vercel-accents-5 block text-xs text-slate-500"
									>
										{{ pluralize(ctx.tabCount, 'tab') }} ·
										{{ relativeTime(ctx.updatedAt) }}
									</span>
								</button>

								<div
									class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
								>
									<AppButton
										intent="ghost"
										size="xs"
										square
										title="Resume"
										@click="resume(ctx.id)"
									>
										<ArrowUturnLeftIcon class="size-3.5" aria-hidden="true" />
										<span class="sr-only">Resume</span>
									</AppButton>

									<Menu as="div" class="relative">
										<MenuButton
											:class="
												button({
													intent: 'ghost',
													size: 'xs',
													square: true,
												})
											"
											title="More"
										>
											<EllipsisHorizontalIcon
												class="size-3.5"
												aria-hidden="true"
											/>
											<span class="sr-only">More actions</span>
										</MenuButton>
										<AppMenuItems width="w-40">
											<AppMenuItem
												:icon="PencilIcon"
												@click="startRename(ctx.id, ctx.name)"
											>
												Rename
											</AppMenuItem>
											<AppMenuItem
												:icon="ArchiveBoxArrowDownIcon"
												@click="archive(ctx.id)"
											>
												Archive
											</AppMenuItem>
											<div class="menu-separator" />
											<AppMenuItem
												:icon="TrashIcon"
												danger
												@click="remove(ctx.id)"
											>
												Delete
											</AppMenuItem>
										</AppMenuItems>
									</Menu>
								</div>
							</template>
						</div>
					</li>
				</ul>
			</section>

			<!-- Empty state -->
			<EmptyState
				v-if="!filtered.length && !activeContext && !visibleGroups.length"
				compact
				:icon="RectangleStackIcon"
				:title="search ? 'No matching groups or contexts' : 'No contexts yet'"
				:description="
					search
						? 'Try a different name.'
						: 'Save your current tabs as a context to switch between sets of work.'
				"
			/>
		</div>
	</div>
</template>
