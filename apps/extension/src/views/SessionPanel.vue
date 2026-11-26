<script setup lang="ts">
/**
 * The side panel: the open session and when it last saved itself, its tab groups and
 * loose tabs, and the sessions you can switch to.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useLibrary } from '@/hooks/useLibrary'
import { useOpenGroups } from '@/hooks/useOpenGroups'
import { useSmartGroup } from '@/hooks/useSmartGroup'
import {
	ArchiveBoxArrowDownIcon,
	ArrowTopRightOnSquareIcon,
	EllipsisHorizontalIcon,
	HomeIcon,
	PencilIcon,
	PlusIcon,
	RectangleStackIcon,
	SparklesIcon,
} from '@heroicons/vue/16/solid'
import { Menu, MenuButton } from '@headlessui/vue'
import { button } from '@/lib/ui'
import { pluralize, timeAgo } from '@/lib/format'
import { isOwnPage } from '@/lib/liveTabs'
import { focusGroup } from '@/lib/tabGroups'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import EmptyState from '@/components/EmptyState.vue'
import LibraryError from '@/components/LibraryError.vue'
import LibraryMoveCard from '@/components/LibraryMoveCard.vue'
import SavedStatus from '@/components/SavedStatus.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import SmartGroupReview from '@/components/SmartGroupReview.vue'
import UnlinkedBanner from '@/components/UnlinkedBanner.vue'

const {
	migrated,
	openSession,
	switchable,
	homeId,
	lastUsed,
	switchTo,
	saveOpenAs,
	putAway,
	openCopy,
	rename,
	archive,
	saveGroupAsSession,
	saveGroupsAsSessions,
} = useLibrary()
const {
	groups: openGroups,
	looseTabs,
	groupableTabs,
	focusedGroupId,
	windowNumbers,
} = useOpenGroups()
const smart = useSmartGroup()
const { review, running, mode: groupingMode, suggest } = smart

const SESSIONS_SHOWN = 8
const search = ref('')
const showAll = ref(false)
const openTabCount = ref(0)

const query = computed(() => search.value.trim().toLowerCase())

const visibleGroups = computed(() => {
	if (!query.value) return openGroups.value
	return openGroups.value.filter((g) => g.title.toLowerCase().includes(query.value))
})

/** Every open group but the one you're in */
const otherGroupIds = computed(() =>
	openGroups.value.filter((g) => g.id !== focusedGroupId.value).map((g) => g.id),
)

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

function smartGroup() {
	void suggest(looseTabs.value, { usedColors: openGroups.value.map((g) => g.color) })
}

/** A fresh regrouping of every tab, ones already in groups included */
function regroupAll() {
	void suggest(groupableTabs.value, { mode: 'all' })
}

/** While a regroup runs or is in review, the section is about every tab */
const regrouping = computed(
	() => groupingMode.value === 'all' && (running.value || !!review.value.length),
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
			<LibraryError compact />
			<LibraryMoveCard compact />
			<UnlinkedBanner compact />

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
					<SavedStatus class="shrink-0" />
				</div>
				<p v-if="isHome" class="dark:text-vercel-accents-5 mt-1 text-xs text-slate-500">
					Where you start. Name these tabs to make them a session you can leave and come
					back to.
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
				Open groups: Chrome's tab groups. Click to focus one (the rest fold up). A group can
				be saved as a session of its own, which closes its tabs.
			-->
			<section v-if="visibleGroups.length">
				<div class="mb-2 flex items-center justify-between">
					<p class="section-label">Open groups · {{ visibleGroups.length }}</p>
					<div class="flex items-center gap-3">
						<button
							v-if="groupableTabs.length >= 2"
							type="button"
							class="dark:text-vercel-accents-5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:hover:text-white"
							:disabled="running"
							title="Group every tab afresh, including tabs already in groups. You review it first, and Undo brings your groups back."
							@click="regroupAll()"
						>
							<SparklesIcon class="size-3" aria-hidden="true" />
							Regroup all
						</button>
						<button
							v-if="migrated && otherGroupIds.length"
							type="button"
							class="dark:text-vercel-accents-5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
							:title="
								focusedGroupId
									? 'Keep the group you are in open. Save each other group as a session of its own, and close it.'
									: 'Save each open group as a session of its own, and close it'
							"
							@click="saveGroupsAsSessions(otherGroupIds)"
						>
							{{
								focusedGroupId ? 'Save others as sessions' : 'Save all as sessions'
							}}
						</button>
					</div>
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
							:title="`Save ${group.title || 'this group'} as a session and close its tabs`"
							@click="saveGroupAsSession(group.id)"
						>
							<ArchiveBoxArrowDownIcon class="size-3.5" aria-hidden="true" />
							<span class="sr-only">
								Save {{ group.title || 'this group' }} as a session
							</span>
						</AppButton>
					</li>
				</ul>
			</section>

			<!-- Loose tabs and smart grouping. Applying creates tab groups; nothing closes. -->
			<section v-if="looseTabs.length || review.length || running" class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<p v-if="regrouping" class="section-label">
						Regrouping · {{ pluralize(groupableTabs.length, 'tab') }}
					</p>
					<p v-else class="section-label">Loose tabs · {{ looseTabs.length }}</p>
					<AppButton
						v-if="!review.length && !regrouping"
						size="xs"
						:disabled="looseTabs.length < 2 || running"
						title="Suggest groups for these tabs. You review them before anything changes."
						@click="smartGroup()"
					>
						<SparklesIcon class="size-3.5" aria-hidden="true" />
						Smart group
					</AppButton>
				</div>

				<SmartGroupReview :smart="smart" />
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
								class="relative opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 data-[headlessui-state~=open]:opacity-100"
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
				v-if="query && !visibleSessions.length && !visibleGroups.length"
				compact
				:icon="RectangleStackIcon"
				title="No matching sessions or groups"
				description="Try a different name."
			/>
		</div>
	</div>
</template>
