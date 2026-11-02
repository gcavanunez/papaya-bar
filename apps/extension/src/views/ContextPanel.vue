<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useContexts } from '@/hooks/useContexts'
import { useIntelligence } from '@/hooks/useIntelligence'
import type { SaveableTab } from '@/types'
import {
	ArchiveBoxArrowDownIcon,
	ArrowUturnLeftIcon,
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
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import EmptyState from '@/components/EmptyState.vue'
import SearchInput from '@/components/forms/SearchInput.vue'

const {
	activeContext,
	switchableContexts,
	liveStats,
	resume,
	stashActive,
	createFromLive,
	peelOff,
	parkStaleTabs,
	rename,
	archive,
	remove,
	refresh,
	refreshLiveStats,
} = useContexts()
const { isSuggesting, suggestions, usedFallback, suggest, dismiss, removeSuggestion } =
	useIntelligence()

const AUTO_PARK_DAYS = 7
const autoPark = ref(false)
const search = ref('')

// Snapshot of current live tabs, used to map LLM suggestions back to real tabs.
async function liveSaveableTabs(): Promise<SaveableTab[]> {
	const tabs = await chrome.tabs.query({})
	const prefix = `chrome-extension://${chrome.runtime.id}`
	return tabs
		.filter((t) => !(t.url || '').startsWith(prefix) && !(t.pendingUrl || '').startsWith(prefix))
		.map((t) => ({
			id: t.id,
			stableId: `stableId-${t.id}`,
			url: t.url,
			title: t.title,
			favIconUrl: t.favIconUrl,
			windowId: t.windowId,
			groupId: t.groupId,
			active: t.active,
		}))
}

async function autoGroup() {
	await suggest(await liveSaveableTabs())
}

async function applySuggestion(index: number) {
	const group = suggestions.value[index]
	if (!group) return
	await peelOff(group.tabs, { name: group.name })
	removeSuggestion(index)
	void refreshLiveStats()
}

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
				<h1 class="text-sm font-semibold">Contexts</h1>
				<span class="dark:text-vercel-accents-5 text-xs text-slate-500 tabular-nums">
					{{ pluralize(liveStats.total, 'live tab') }}
				</span>
			</div>
			<SearchInput v-model="search" size="sm" placeholder="Search contexts…" />
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
					<AppButton
						size="sm"
						class="mt-2 w-full"
						:disabled="liveStats.total === 0 || isSuggesting"
						@click="autoGroup"
					>
						<SparklesIcon class="size-3.5" aria-hidden="true" />
						{{ isSuggesting ? 'Grouping…' : 'Auto-group tabs' }}
					</AppButton>
				</template>
			</section>

			<!-- LLM grouping suggestions -->
			<section v-if="suggestions.length" class="space-y-2">
				<div class="flex items-center justify-between">
					<p class="section-label">Suggested groups</p>
					<button
						type="button"
						class="dark:text-vercel-accents-5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
						@click="dismiss"
					>
						Dismiss
					</button>
				</div>
				<p v-if="usedFallback" class="dark:text-vercel-accents-5 text-xs text-slate-500">
					Grouped by site. Sign in and deploy the AI backend for smarter grouping.
				</p>
				<div class="card dark:divide-vercel-accents-2 divide-y divide-slate-100">
					<div
						v-for="(group, i) in suggestions"
						:key="i"
						class="flex items-center gap-2 py-2 pr-1.5 pl-3"
					>
						<SparklesIcon class="size-4 shrink-0 text-indigo-400" aria-hidden="true" />
						<div class="min-w-0 flex-1">
							<input
								v-model="group.name"
								class="w-full truncate rounded border-0 bg-transparent p-0 text-sm font-medium focus:ring-0 focus:outline-none"
								aria-label="Suggested context name"
							/>
							<span class="dark:text-vercel-accents-5 text-xs text-slate-500">
								{{ pluralize(group.tabs.length, 'tab') }}
							</span>
						</div>
						<AppButton size="xs" @click="applySuggestion(i)">Create</AppButton>
						<AppButton
							intent="ghost"
							size="xs"
							square
							title="Remove suggestion"
							@click="removeSuggestion(i)"
						>
							<XMarkIcon class="size-3.5" aria-hidden="true" />
						</AppButton>
					</div>
				</div>
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
				<p class="section-label mb-2">Stashed</p>
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
				v-if="!filtered.length && !activeContext"
				compact
				:icon="RectangleStackIcon"
				:title="search ? 'No matching contexts' : 'No contexts yet'"
				:description="
					search
						? 'Try a different name.'
						: 'Save your current tabs as a context to switch between sets of work.'
				"
			/>
		</div>
	</div>
</template>
