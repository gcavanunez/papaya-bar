<script setup lang="ts">
/**
 * The side panel: the open session, its tab groups and loose tabs, and the sessions you
 * can switch to.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useLibrary } from '@/hooks/useLibrary'
import { useOpenGroups } from '@/hooks/useOpenGroups'
import { useSmartGroup } from '@/hooks/useSmartGroup'
import {
	ArchiveBoxArrowDownIcon,
	ArrowsPointingInIcon,
	ArrowTopRightOnSquareIcon,
	BookmarkIcon,
	ChevronDownIcon,
	EllipsisHorizontalIcon,
	HomeIcon,
	PencilIcon,
	PlusIcon,
	RectangleStackIcon,
	SparklesIcon,
	TrashIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import { Menu, MenuButton } from '@headlessui/vue'
import { button } from '@/lib/ui'
import { pluralize, timeAgo } from '@/lib/format'
import { isOwnPage } from '@/lib/liveTabs'
import type { Engine } from '@/lib/smartGroup'
import { focusGroup } from '@/lib/tabGroups'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import EmptyState from '@/components/EmptyState.vue'
import LibraryMoveCard from '@/components/LibraryMoveCard.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const {
	migrated,
	openSession,
	switchable,
	homeId,
	lastUsed,
	switchTo,
	saveVersion,
	saveOpenAs,
	putAway,
	openCopy,
	rename,
	archive,
	stashed,
	stashGroup,
	stashGroups,
	openStashed,
	swapToStashed,
	swapToGroup,
	renameStashed,
	moveStashed,
	deleteStashed,
} = useLibrary()
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
	opencode,
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

const SESSIONS_SHOWN = 8
const search = ref('')
const showAll = ref(false)
const openTabCount = ref(0)

const query = computed(() => search.value.trim().toLowerCase())

const visibleGroups = computed(() => {
	if (!query.value) return openGroups.value
	return openGroups.value.filter((g) => g.title.toLowerCase().includes(query.value))
})

const visibleStashed = computed(() =>
	query.value
		? stashed.value.filter((g) => g.name.toLowerCase().includes(query.value))
		: stashed.value,
)

/** Every open group but the one you're in */
const otherGroupIds = computed(() =>
	openGroups.value.filter((g) => g.id !== focusedGroupId.value).map((g) => g.id),
)

// Shift swaps: the group you're in is stashed as you leave it
function onGroupClick(groupId: number, event: MouseEvent) {
	if (event.shiftKey && migrated.value) void swapToGroup(groupId)
	else void focusGroup(groupId)
}
function onStashedClick(stashId: string, event: MouseEvent) {
	if (event.shiftKey) void swapToStashed(stashId)
	else void openStashed(stashId)
}

const editingStashId = ref<string | null>(null)
const editingStashName = ref('')
function startStashRename(id: string, current: string) {
	editingStashId.value = id
	editingStashName.value = current
}
function commitStashRename() {
	if (editingStashId.value && editingStashName.value.trim()) {
		void renameStashed(editingStashId.value, editingStashName.value.trim())
	}
	editingStashId.value = null
}

const matchingSessions = computed(() =>
	query.value
		? switchable.value.filter((s) =>
				`${s.name} ${s.description}`.toLowerCase().includes(query.value),
			)
		: switchable.value,
)
const visibleSessions = computed(() =>
	query.value || showAll.value
		? matchingSessions.value
		: matchingSessions.value.slice(0, SESSIONS_SHOWN),
)

const isHome = computed(() => !openSession.value || openSession.value.id === homeId)

function smartGroup(preferred: Engine | 'auto' = 'auto') {
	expandedKey.value = null
	void suggest(looseTabs.value, {
		engine: preferred,
		usedColors: openGroups.value.map((g) => g.color),
	})
}

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

const percent = (fraction: number) => Math.round(fraction * 100)
const groupingPercent = computed(() =>
	progress.value.total ? percent(progress.value.done / progress.value.total) : 0,
)

// ---------- The open session ----------

const naming = ref(false)
const newName = ref('')
async function onSaveAs() {
	const name = newName.value.trim()
	if (!name) return
	await saveOpenAs(name)
	newName.value = ''
	naming.value = false
}

const editingId = ref<string | null>(null)
const editingName = ref('')
function startRename(id: string, current: string) {
	editingId.value = id
	editingName.value = current
}
function commitRename() {
	if (editingId.value && editingName.value.trim()) {
		void rename(editingId.value, editingName.value.trim())
	}
	editingId.value = null
}

function openLibrary() {
	void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/sessions') })
}

// ---------- Open tab count ----------

async function refreshOpenTabCount() {
	openTabCount.value = (await chrome.tabs.query({})).filter((t) => !isOwnPage(t)).length
}

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

const ago = (ts: number) => timeAgo(ts) || 'never'

let statsTimer: ReturnType<typeof setTimeout> | undefined
function onTabsChanged() {
	clearTimeout(statsTimer)
	statsTimer = setTimeout(() => void refreshOpenTabCount(), 200)
}
const tabEvents = [
	chrome.tabs.onCreated,
	chrome.tabs.onRemoved,
	chrome.tabs.onUpdated,
	chrome.tabs.onActivated,
] as chrome.events.Event<() => void>[]

onMounted(() => {
	void refreshModelStatus()
	void refreshOpenTabCount()
	tabEvents.forEach((event) => event.addListener(onTabsChanged))
})
onUnmounted(() => {
	clearTimeout(statsTimer)
	tabEvents.forEach((event) => event.removeListener(onTabsChanged))
})
</script>

<template>
	<div
		class="dark:bg-vercel-accents-1 flex h-screen flex-col bg-slate-50 text-slate-900 antialiased dark:text-white"
	>
		<header
			class="dark:border-vercel-accents-2 shrink-0 space-y-3 border-b border-slate-200 bg-white px-4 py-3 dark:bg-black"
		>
			<div class="flex items-center justify-between">
				<h1 class="text-sm font-semibold">Sessions &amp; groups</h1>
				<span class="dark:text-vercel-accents-5 text-xs tabular-nums text-slate-500">
					{{ pluralize(openTabCount, 'open tab') }}
				</span>
			</div>
			<SearchInput v-model="search" size="sm" placeholder="Search sessions and groups…" />
		</header>

		<div class="flex-1 space-y-4 overflow-y-auto p-4">
			<LibraryMoveCard compact />

			<!-- The open session -->
			<section v-if="migrated" class="card p-3" aria-label="Open session">
				<div class="flex items-center gap-2">
					<HomeIcon
						v-if="isHome"
						class="dark:text-vercel-accents-5 size-4 shrink-0 text-slate-400"
						aria-hidden="true"
					/>
					<span
						v-else
						class="size-2.5 shrink-0 rounded-full"
						:class="dot(openSession!.color)"
					/>
					<input
						v-if="openSession && editingId === openSession.id"
						v-model="editingName"
						autofocus
						class="field h-7 min-w-0 flex-1 px-2"
						aria-label="Session name"
						@keyup.enter="commitRename"
						@keyup.esc="editingId = null"
						@blur="commitRename"
					/>
					<span v-else class="min-w-0 flex-1 truncate text-sm font-medium">
						{{ openSession?.name ?? 'Home' }}
					</span>
					<span
						class="bg-papaya-900/10 text-papaya-900 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
					>
						Open
					</span>
				</div>
				<p class="dark:text-vercel-accents-5 mt-1 text-xs text-slate-500">
					<template v-if="isHome">
						Where you start. Name these tabs to make them a session you can leave and
						come back to.
					</template>
					<template v-else>
						Saved {{ ago(openSession!.updatedAt) }}. Switching away saves it as you left
						it.
					</template>
				</p>

				<form v-if="naming" class="mt-3 flex gap-2" @submit.prevent="onSaveAs">
					<input
						v-model="newName"
						autofocus
						placeholder="Session name…"
						aria-label="Session name"
						class="field h-7 min-w-0 flex-1 px-2"
						@keyup.esc="naming = false"
					/>
					<AppButton intent="primary" size="sm" type="submit">Save</AppButton>
				</form>
				<AppButton
					v-else-if="isHome"
					intent="primary"
					size="sm"
					class="mt-3 w-full"
					:disabled="openTabCount === 0"
					@click="naming = true"
				>
					<PlusIcon class="size-3.5" aria-hidden="true" />
					Save as a session…
				</AppButton>
				<div v-else class="mt-3 flex gap-2">
					<AppButton size="sm" class="flex-1" @click="saveVersion">
						<BookmarkIcon class="size-3.5" aria-hidden="true" />
						Save version
					</AppButton>
					<AppButton
						size="sm"
						class="flex-1"
						title="Save it, close its tabs, and go Home"
						@click="putAway"
					>
						<ArchiveBoxArrowDownIcon class="size-3.5" aria-hidden="true" />
						Put away
					</AppButton>
					<Menu as="div" class="relative">
						<MenuButton
							:class="button({ intent: 'ghost', size: 'sm', square: true })"
							title="More"
						>
							<EllipsisHorizontalIcon class="size-3.5" aria-hidden="true" />
							<span class="sr-only">More actions</span>
						</MenuButton>
						<AppMenuItems width="w-52">
							<AppMenuItem
								:icon="PencilIcon"
								@click="startRename(openSession!.id, openSession!.name)"
							>
								Rename
							</AppMenuItem>
							<AppMenuItem :icon="PlusIcon" @click="naming = true">
								Save as a new session…
							</AppMenuItem>
						</AppMenuItems>
					</Menu>
				</div>
			</section>

			<!--
				Open groups: Chrome's tab groups. Click to focus one (the rest fold up); Shift-click
				to swap, stashing the group you're in. Stash puts a group away in the open session.
			-->
			<section v-if="visibleGroups.length">
				<div class="mb-2 flex items-center justify-between">
					<p class="section-label">Open groups · {{ visibleGroups.length }}</p>
					<button
						v-if="migrated && otherGroupIds.length"
						type="button"
						class="dark:text-vercel-accents-5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
						:title="
							focusedGroupId
								? 'Keep the group you are in open and stash the rest'
								: 'Stash every open group'
						"
						@click="stashGroups(otherGroupIds)"
					>
						{{ focusedGroupId ? 'Stash the others' : 'Stash all' }}
					</button>
				</div>
				<ul
					role="list"
					class="card dark:divide-vercel-accents-2 divide-y divide-slate-100 overflow-hidden"
				>
					<li
						v-for="group in visibleGroups"
						:key="group.id"
						class="group/row dark:hover:bg-vercel-accents-1 relative flex items-center hover:bg-slate-50"
						:class="
							group.id === focusedGroupId
								? 'dark:bg-vercel-accents-1 bg-slate-50'
								: ''
						"
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 pr-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
							:aria-current="group.id === focusedGroupId ? 'true' : undefined"
							:title="
								migrated
									? `Go to ${group.title || 'this group'}. Shift-click to swap: the group you're in is stashed.`
									: `Go to ${group.title || 'this group'} and fold the other groups`
							"
							@click="onGroupClick(group.id, $event)"
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
										: 'dark:text-vercel-accents-5 italic text-slate-500'
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
								class="dark:text-vercel-accents-5 text-xs tabular-nums text-slate-500"
							>
								{{ group.tabIds.length }}
							</span>
						</button>
						<AppButton
							v-if="migrated"
							intent="ghost"
							size="xs"
							square
							class="mr-1.5 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
							:title="`Stash ${group.title || 'this group'}: close its tabs and keep it here`"
							@click="stashGroup(group.id)"
						>
							<ArchiveBoxArrowDownIcon class="size-3.5" aria-hidden="true" />
							<span class="sr-only">Stash {{ group.title || 'this group' }}</span>
						</AppButton>
					</li>
				</ul>
			</section>

			<!-- Stashed groups of the open session: click to open (Shift-click swaps) -->
			<section v-if="migrated && visibleStashed.length">
				<p class="section-label mb-2">Stashed · {{ visibleStashed.length }}</p>
				<ul role="list" class="card dark:divide-vercel-accents-2 divide-y divide-slate-100">
					<li
						v-for="item in visibleStashed"
						:key="item.id"
						class="group/row dark:hover:bg-vercel-accents-1 flex items-center gap-2.5 py-2 pl-3 pr-1.5 hover:bg-slate-50"
					>
						<span
							class="size-2.5 shrink-0 rounded-full opacity-60"
							:class="dot(item.color)"
						/>
						<input
							v-if="editingStashId === item.id"
							v-model="editingStashName"
							autofocus
							class="field h-7 min-w-0 flex-1 px-2"
							aria-label="Group name"
							@keyup.enter="commitStashRename"
							@keyup.esc="editingStashId = null"
							@blur="commitStashRename"
						/>
						<button
							v-else
							type="button"
							class="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-blue-500"
							:title="`Open ${item.name}. Shift-click to swap: the group you're in is stashed.`"
							@click="onStashedClick(item.id, $event)"
						>
							<span class="block truncate text-sm font-medium">{{ item.name }}</span>
							<span class="dark:text-vercel-accents-5 block text-xs text-slate-500">
								{{ pluralize(item.tabCount, 'tab') }} · stashed
								{{ ago(item.createdAt) }}
							</span>
						</button>
						<Menu
							v-if="editingStashId !== item.id"
							as="div"
							class="relative opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100"
						>
							<MenuButton
								:class="button({ intent: 'ghost', size: 'xs', square: true })"
								title="More"
							>
								<EllipsisHorizontalIcon class="size-3.5" aria-hidden="true" />
								<span class="sr-only">More actions</span>
							</MenuButton>
							<AppMenuItems width="w-56">
								<AppMenuItem
									:icon="PencilIcon"
									@click="startStashRename(item.id, item.name)"
								>
									Rename
								</AppMenuItem>
								<template v-if="switchable.length">
									<div class="menu-separator" />
									<p class="menu-heading">Move to session</p>
									<AppMenuItem
										v-for="target in switchable.slice(0, 8)"
										:key="target.id"
										@click="moveStashed(item.id, target.id)"
									>
										{{ target.name }}
									</AppMenuItem>
								</template>
								<div class="menu-separator" />
								<AppMenuItem
									:icon="TrashIcon"
									danger
									@click="deleteStashed(item.id)"
								>
									Delete
								</AppMenuItem>
							</AppMenuItems>
						</Menu>
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
								opencode
									? `Grouping by topic with ${opencode.model} (opencode)…`
									: modelStatus === 'available'
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
					<p class="dark:text-vercel-accents-5 tabular-nums text-slate-500">
						{{ progress.done }} of {{ pluralize(progress.total, 'tab') }}
					</p>
				</div>

				<template v-if="review.length && !running">
					<p class="dark:text-vercel-accents-5 text-xs text-slate-500">
						<template v-if="engine === 'opencode'">
							Grouped by topic with {{ opencode?.model ?? 'your model' }} through
							opencode.
						</template>
						<template v-else-if="engine === 'on-device'">
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
						{{ pluralize(leftLoose, 'tab') }} fit no group and stay loose.
					</p>
					<p v-if="fallbackReason" class="text-xs text-amber-700 dark:text-amber-300">
						{{ fallbackReason }}. So these are grouped
						{{ engine === 'on-device' ? 'on this device' : 'by site' }} instead.
					</p>
					<div class="flex gap-2">
						<AppButton intent="primary" size="sm" class="flex-1" @click="apply">
							Group {{ pluralize(reviewTabCount, 'tab') }}
						</AppButton>
						<AppButton size="sm" @click="dismiss">Cancel</AppButton>
					</div>
					<div class="flex flex-wrap gap-x-3 gap-y-1">
						<button
							v-for="other in otherEngines"
							:key="other.engine"
							type="button"
							class="dark:text-vercel-accents-5 text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline dark:hover:text-white"
							@click="smartGroup(other.engine)"
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

			<!-- Sessions to switch to -->
			<section v-if="migrated && visibleSessions.length">
				<div class="mb-2 flex items-center justify-between">
					<p class="section-label">Sessions · {{ matchingSessions.length }}</p>
					<button
						type="button"
						class="dark:text-vercel-accents-5 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
						@click="openLibrary"
					>
						All sessions
						<ArrowTopRightOnSquareIcon class="size-3" aria-hidden="true" />
					</button>
				</div>
				<ul role="list" class="card dark:divide-vercel-accents-2 divide-y divide-slate-100">
					<li v-for="session in visibleSessions" :key="session.id">
						<div
							class="dark:hover:bg-vercel-accents-1 group flex items-center gap-2.5 py-2 pl-3 pr-1.5 hover:bg-slate-50"
						>
							<HomeIcon
								v-if="session.kind === 'home'"
								class="dark:text-vercel-accents-5 size-3 shrink-0 text-slate-400"
								aria-hidden="true"
							/>
							<span
								v-else
								class="size-2.5 shrink-0 rounded-full"
								:class="dot(session.color)"
							/>
							<input
								v-if="editingId === session.id"
								v-model="editingName"
								autofocus
								class="field h-7 min-w-0 flex-1 px-2"
								aria-label="Session name"
								@keyup.enter="commitRename"
								@keyup.esc="editingId = null"
								@blur="commitRename"
							/>
							<button
								v-else
								type="button"
								class="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-blue-500"
								:title="`Switch to ${session.name}`"
								@click="switchTo(session.id)"
							>
								<span class="block truncate text-sm font-medium">{{
									session.name
								}}</span>
								<span
									class="dark:text-vercel-accents-5 block text-xs text-slate-500"
								>
									{{ pluralize(session.tabCount, 'tab') }} ·
									{{ ago(lastUsed(session)) }}
								</span>
							</button>
							<Menu
								v-if="editingId !== session.id"
								as="div"
								class="relative opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
							>
								<MenuButton
									:class="button({ intent: 'ghost', size: 'xs', square: true })"
									title="More"
								>
									<EllipsisHorizontalIcon class="size-3.5" aria-hidden="true" />
									<span class="sr-only">More actions</span>
								</MenuButton>
								<AppMenuItems width="w-48">
									<AppMenuItem
										:icon="ArrowTopRightOnSquareIcon"
										@click="openCopy(session.id)"
									>
										Open a copy
									</AppMenuItem>
									<AppMenuItem
										:icon="PencilIcon"
										@click="startRename(session.id, session.name)"
									>
										Rename
									</AppMenuItem>
									<AppMenuItem
										v-if="session.kind !== 'home'"
										:icon="ArchiveBoxArrowDownIcon"
										@click="archive(session.id)"
									>
										Archive
									</AppMenuItem>
								</AppMenuItems>
							</Menu>
						</div>
					</li>
				</ul>
				<button
					v-if="!query && !showAll && matchingSessions.length > SESSIONS_SHOWN"
					type="button"
					class="dark:text-vercel-accents-5 mt-2 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
					@click="showAll = true"
				>
					Show all {{ matchingSessions.length }}
				</button>
			</section>

			<EmptyState
				v-if="
					query &&
					!visibleSessions.length &&
					!visibleGroups.length &&
					!visibleStashed.length
				"
				compact
				:icon="RectangleStackIcon"
				title="No matching sessions or groups"
				description="Try a different name."
			/>
		</div>
	</div>
</template>
