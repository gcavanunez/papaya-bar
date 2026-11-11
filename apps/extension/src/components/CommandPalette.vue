<script setup lang="ts">
/**
 * ⌘K command palette — the fast lane for the swap loop.
 * Switch sessions or groups, run session commands, or jump to any open or saved tab.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
	Combobox,
	ComboboxInput,
	ComboboxOptions,
	ComboboxOption,
	Dialog,
	DialogPanel,
	TransitionChild,
	TransitionRoot,
} from '@headlessui/vue'
import {
	ArchiveBoxArrowDownIcon,
	BookmarkIcon,
	HomeIcon,
	MagnifyingGlassIcon,
	PlusIcon,
} from '@heroicons/vue/16/solid'
import TabFavicon from './TabFavicon.vue'
import { useLibrary } from '@/hooks/useLibrary'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useIntelligence } from '@/hooks/useIntelligence'
import { isPaletteShortcut, paletteShortcutLabel } from '@/lib/platform'
import { focusGroup, listOpenGroups, type OpenGroup } from '@/lib/tabGroups'

interface GroupItem {
	kind: 'group'
	key: string
	id: number
	label: string
	color: string
	tabCount: number
}
interface SessionItem {
	kind: 'session'
	key: string
	id: string
	label: string
	color: string
	tabCount: number
	isHome: boolean
}
interface CommandItem {
	kind: 'command'
	key: string
	label: string
	icon: typeof PlusIcon
	run: () => void | Promise<void>
}
interface TabItem {
	kind: 'tab'
	key: string
	id: number
	label: string
	url: string
	favIconUrl?: string
}
interface SavedTabItem {
	kind: 'savedtab'
	key: string
	label: string
	url: string
	favIconUrl?: string
	sessionName: string
}
type PaletteItem = GroupItem | SessionItem | CommandItem | TabItem | SavedTabItem

const { switchable, openSession, homeId, library, switchTo, saveVersion, saveOpenAs, putAway } =
	useLibrary()
const { loadedTabs } = useChromeTabs()
const { isOpen, close, toggle } = useCommandPalette()
const { semanticSearch } = useIntelligence()

const query = ref('')

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
const optionClass = (active: boolean) => [
	'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2',
	active ? 'dark:bg-vercel-accents-2 bg-slate-100' : '',
]

const matches = (text: string) => text.toLowerCase().includes(query.value.trim().toLowerCase())

// Chrome's tab groups, read fresh each time the palette opens
const openGroups = ref<OpenGroup[]>([])
watch(isOpen, async (open) => {
	if (open) openGroups.value = await listOpenGroups()
})

const groupItems = computed<GroupItem[]>(() =>
	openGroups.value
		.filter((g) => matches(g.title || 'Unnamed group'))
		.slice(0, 8)
		.map((g) => ({
			kind: 'group',
			key: `group-${g.id}`,
			id: g.id,
			label: g.title || 'Unnamed group',
			color: g.color,
			tabCount: g.tabIds.length,
		})),
)

const sessionItems = computed<SessionItem[]>(() =>
	switchable.value
		.filter((s) => matches(s.name))
		.slice(0, 6)
		.map((s) => ({
			kind: 'session',
			key: `session-${s.id}`,
			id: s.id,
			label: s.name,
			color: s.color,
			tabCount: s.tabCount,
			isHome: s.id === homeId,
		})),
)

const commandItems = computed<CommandItem[]>(() => {
	const cmds: CommandItem[] = []
	const open = openSession.value
	if (open && open.id !== homeId) {
		cmds.push(
			{
				kind: 'command',
				key: 'cmd-version',
				label: `Save a version of “${open.name}”`,
				icon: BookmarkIcon,
				run: saveVersion,
			},
			{
				kind: 'command',
				key: 'cmd-away',
				label: `Put “${open.name}” away`,
				icon: ArchiveBoxArrowDownIcon,
				run: putAway,
			},
		)
	}
	cmds.push({
		kind: 'command',
		key: 'cmd-new',
		label: 'Save open tabs as a new session…',
		icon: PlusIcon,
		run: promptNewSession,
	})
	return cmds.filter((c) => matches(c.label))
})

const tabItems = computed<TabItem[]>(() => {
	if (!query.value.trim()) return []
	return loadedTabs.value
		.filter((t) => matches(t.title || '') || matches(t.url || ''))
		.slice(0, 8)
		.map((t) => ({
			kind: 'tab',
			key: `tab-${t.id}`,
			id: t.id as number,
			label: t.title || t.url || 'Untitled',
			url: t.url || '',
			favIconUrl: t.favIconUrl,
		}))
})

// Saved-tab results are async (semantic ranking via the backend), so they live
// in a ref updated by a debounced watcher rather than a computed.
const savedTabResults = ref<SavedTabItem[]>([])
let savedSearchSeq = 0

interface SavedEntry {
	key: string
	title: string
	url: string
	favIconUrl: string
	sessionName: string
}

function toSavedItem(entry: SavedEntry): SavedTabItem {
	return {
		kind: 'savedtab',
		key: `saved-${entry.key}`,
		label: entry.title || entry.url,
		url: entry.url,
		favIconUrl: entry.favIconUrl,
		sessionName: entry.sessionName,
	}
}

/** Every tab in every closed session's newest version (contents load once, then cache) */
async function savedEntries(): Promise<SavedEntry[]> {
	const lib = await library()
	const heads = switchable.value.filter((s) => s.headVersionId)
	const data = await lib.blobs.getMany(heads.map((s) => s.headVersionId))
	return heads.flatMap((s) =>
		(data.get(s.headVersionId)?.tabs ?? []).map((tab, i) => ({
			key: `${s.id}-${i}`,
			title: tab.title,
			url: tab.url,
			favIconUrl: tab.favIconUrl,
			sessionName: s.name,
		})),
	)
}

watchDebounced(
	query,
	async (raw) => {
		const term = (raw ?? '').trim()
		const seq = ++savedSearchSeq
		if (!term) {
			savedTabResults.value = []
			return
		}

		const all = await savedEntries()
		if (seq !== savedSearchSeq) return

		// 1. Instant local substring results.
		const lower = term.toLowerCase()
		const local = all.filter((e) => `${e.title} ${e.url}`.toLowerCase().includes(lower))
		savedTabResults.value = local.slice(0, 6).map(toSavedItem)

		// 2. Upgrade to semantic ranking when the backend is reachable.
		if (term.length < 2) return
		const ranked = await semanticSearch(
			term,
			all.slice(0, 300).map((e) => ({ stableId: e.key, title: e.title, url: e.url })),
		)
		if (!ranked || seq !== savedSearchSeq) return // stale or unavailable

		const byKey = new Map(all.map((e) => [e.key, e]))
		const ordered = ranked
			.map((k) => byKey.get(k))
			.filter((e): e is (typeof all)[number] => e != null)
			.slice(0, 6)
		if (ordered.length) savedTabResults.value = ordered.map(toSavedItem)
	},
	{ debounce: 250 },
)

const hasResults = computed(
	() =>
		groupItems.value.length +
			sessionItems.value.length +
			commandItems.value.length +
			tabItems.value.length +
			savedTabResults.value.length >
		0,
)

async function promptNewSession() {
	const name = window.prompt('Name this session')
	if (name?.trim()) await saveOpenAs(name.trim())
}

function activateTab(id: number) {
	chrome.tabs.get(id, (t) => {
		if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true })
		chrome.tabs.update(id, { active: true })
	})
}

async function onSelect(item: PaletteItem | null) {
	if (!item) return
	close()
	if (item.kind === 'group') await focusGroup(item.id)
	else if (item.kind === 'session') await switchTo(item.id)
	else if (item.kind === 'command') await item.run()
	else if (item.kind === 'tab') activateTab(item.id)
	else if (item.kind === 'savedtab') chrome.tabs.create({ url: item.url })
}

function onKeydown(e: KeyboardEvent) {
	if (isPaletteShortcut(e)) {
		e.preventDefault()
		toggle()
	}
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
	<TransitionRoot :show="isOpen" as="template" appear @after-leave="query = ''">
		<Dialog class="relative z-[100]" @close="close">
			<TransitionChild
				as="template"
				enter="ease-out duration-150"
				enter-from="opacity-0"
				enter-to="opacity-100"
				leave="ease-in duration-100"
				leave-from="opacity-100"
				leave-to="opacity-0"
			>
				<div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/70" />
			</TransitionChild>

			<div class="fixed inset-0 overflow-y-auto p-4 pt-[14vh]">
				<TransitionChild
					as="template"
					enter="ease-out duration-150"
					enter-from="opacity-0 scale-95"
					enter-to="opacity-100 scale-100"
					leave="ease-in duration-100"
					leave-from="opacity-100 scale-100"
					leave-to="opacity-0 scale-95"
				>
					<DialogPanel
						class="dark:border-vercel-accents-2 mx-auto max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5 transition-all dark:border dark:bg-black dark:ring-0"
					>
						<Combobox @update:model-value="onSelect">
							<div
								class="dark:border-vercel-accents-2 flex items-center gap-3 border-b border-slate-100 px-4"
							>
								<MagnifyingGlassIcon
									class="dark:text-vercel-accents-5 size-4 shrink-0 text-slate-400"
									aria-hidden="true"
								/>
								<ComboboxInput
									class="dark:placeholder:text-vercel-accents-4 h-12 w-full border-0 bg-transparent p-0 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none dark:text-white"
									placeholder="Jump to a group, session, command or open tab…"
									autocomplete="off"
									@change="query = $event.target.value"
								/>
								<kbd class="kbd shrink-0">esc</kbd>
							</div>

							<ComboboxOptions
								v-if="hasResults"
								static
								class="max-h-80 overflow-y-auto p-1.5 text-sm"
							>
								<!-- Open tab groups -->
								<template v-if="groupItems.length">
									<li class="section-label px-2.5 pt-2 pb-1" role="presentation">
										Go to group
									</li>
									<ComboboxOption
										v-for="item in groupItems"
										:key="item.key"
										v-slot="{ active }"
										:value="item"
										as="template"
									>
										<li :class="optionClass(active)">
											<span
												class="flex size-4 shrink-0 items-center justify-center"
											>
												<span
													class="size-2.5 rounded-full"
													:class="dot(item.color)"
												/>
											</span>
											<span
												class="flex-1 truncate text-slate-900 dark:text-white"
											>
												{{ item.label }}
											</span>
											<span
												class="dark:text-vercel-accents-5 text-xs text-slate-400 tabular-nums"
											>
												{{ item.tabCount }} tabs
											</span>
										</li>
									</ComboboxOption>
								</template>

								<!-- Sessions -->
								<template v-if="sessionItems.length">
									<li
										class="section-label px-2.5 pb-1"
										:class="groupItems.length ? 'pt-3' : 'pt-2'"
										role="presentation"
									>
										Switch to session
									</li>
									<ComboboxOption
										v-for="item in sessionItems"
										:key="item.key"
										v-slot="{ active }"
										:value="item"
										as="template"
									>
										<li :class="optionClass(active)">
											<span
												class="flex size-4 shrink-0 items-center justify-center"
											>
												<HomeIcon
													v-if="item.isHome"
													class="dark:text-vercel-accents-5 size-3.5 text-slate-400"
													aria-hidden="true"
												/>
												<span
													v-else
													class="size-2.5 rounded-full"
													:class="dot(item.color)"
												/>
											</span>
											<span
												class="flex-1 truncate text-slate-900 dark:text-white"
											>
												{{ item.label }}
											</span>
											<span
												class="dark:text-vercel-accents-5 text-xs text-slate-400 tabular-nums"
											>
												{{ item.tabCount }} tabs
											</span>
										</li>
									</ComboboxOption>
								</template>

								<!-- Commands -->
								<template v-if="commandItems.length">
									<li class="section-label px-2.5 pt-3 pb-1" role="presentation">
										Actions
									</li>
									<ComboboxOption
										v-for="item in commandItems"
										:key="item.key"
										v-slot="{ active }"
										:value="item"
										as="template"
									>
										<li :class="optionClass(active)">
											<component
												:is="item.icon"
												class="dark:text-vercel-accents-5 size-4 shrink-0 text-slate-400"
											/>
											<span
												class="flex-1 truncate text-slate-900 dark:text-white"
											>
												{{ item.label }}
											</span>
										</li>
									</ComboboxOption>
								</template>

								<!-- Open tabs -->
								<template v-if="tabItems.length">
									<li class="section-label px-2.5 pt-3 pb-1" role="presentation">
										Open tabs
									</li>
									<ComboboxOption
										v-for="item in tabItems"
										:key="item.key"
										v-slot="{ active }"
										:value="item"
										as="template"
									>
										<li :class="optionClass(active)">
											<TabFavicon :src="item.favIconUrl" :url="item.url" />
											<span
												class="flex-1 truncate text-slate-900 dark:text-white"
											>
												{{ item.label }}
											</span>
										</li>
									</ComboboxOption>
								</template>

								<!-- Saved tabs across all sessions -->
								<template v-if="savedTabResults.length">
									<li class="section-label px-2.5 pt-3 pb-1" role="presentation">
										Saved in sessions
									</li>
									<ComboboxOption
										v-for="item in savedTabResults"
										:key="item.key"
										v-slot="{ active }"
										:value="item"
										as="template"
									>
										<li :class="optionClass(active)">
											<TabFavicon :src="item.favIconUrl" :url="item.url" />
											<span
												class="flex-1 truncate text-slate-900 dark:text-white"
											>
												{{ item.label }}
											</span>
											<span
												class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500"
											>
												{{ item.sessionName }}
											</span>
										</li>
									</ComboboxOption>
								</template>
							</ComboboxOptions>

							<div
								v-else
								class="dark:text-vercel-accents-5 px-4 py-10 text-center text-sm text-slate-500"
							>
								No matches.
							</div>

							<div
								class="dark:border-vercel-accents-2 dark:bg-vercel-accents-1 dark:text-vercel-accents-5 flex items-center gap-4 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500"
							>
								<span class="flex items-center gap-1.5">
									<kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> Navigate
								</span>
								<span class="flex items-center gap-1.5">
									<kbd class="kbd">↵</kbd> Open
								</span>
								<span class="ml-auto flex items-center gap-1.5">
									<kbd class="kbd">{{ paletteShortcutLabel }}</kbd> Toggle
								</span>
							</div>
						</Combobox>
					</DialogPanel>
				</TransitionChild>
			</div>
		</Dialog>
	</TransitionRoot>
</template>
