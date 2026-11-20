<script setup lang="ts">
/**
 * One session: its tabs (by window and group), its History, and edits. Edits to a
 * closed session save at once, each with Undo. History holds the states it can go back
 * to: look at one, open a copy of it, or restore it.
 */
import { computed, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
import { toast } from 'vue-sonner'
import { Menu, MenuButton } from '@headlessui/vue'
import {
	ArchiveBoxArrowDownIcon,
	ArrowTopRightOnSquareIcon,
	ArrowUturnLeftIcon,
	ArrowsRightLeftIcon,
	BookmarkIcon,
	ChevronRightIcon,
	EllipsisHorizontalIcon,
	PencilIcon,
	TrashIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import { useLibrary } from '@/hooks/useLibrary'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import { getDisplayUrl, pluralize, timeAgo } from '@/lib/format'
import { removeGroup, removeTab, renameGroup, ungroup, type Edit } from '@/lib/library/edits'
import {
	emptyContent,
	sameContent,
	type CheckpointReason,
	type SessionContent,
	type SavedGroup,
	type SavedTab,
} from '@/lib/library/model'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import AppModal from '@/components/AppModal.vue'
import AppInput from '@/components/forms/AppInput.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import EmptyState from '@/components/EmptyState.vue'
import LibraryError from '@/components/LibraryError.vue'
import PageHeader from '@/components/PageHeader.vue'
import SavedStatus from '@/components/SavedStatus.vue'
import TabFavicon from '@/components/TabFavicon.vue'
import UnlinkedBanner from '@/components/UnlinkedBanner.vue'

const props = defineProps<{ uid: string }>()
const router = useRouter()
const { triggerConfirm } = useGlobalConfirm()
const {
	ready,
	sessions,
	revision,
	lastUsed,
	needsChoice,
	openError,
	getContent,
	listCheckpoints,
	switchTo,
	openCopy,
	rename,
	setNotes,
	archive,
	unarchive,
	remove,
	restoreCheckpoint,
	saveEdits,
	stashedAll,
	getStashedTabs,
	openStashed,
	deleteStashed,
} = useLibrary()

// ---------- Stashed groups ----------

const sessionStashed = computed(() => stashedAll.value.filter((g) => g.sessionId === props.uid))
/** Tabs of the stashed groups you've expanded, loaded on first expand */
const stashTabs = ref(new Map<string, SavedTab[]>())
async function toggleStash(id: string, open: boolean) {
	if (open && !stashTabs.value.has(id)) {
		stashTabs.value = new Map(stashTabs.value).set(id, await getStashedTabs(id))
	}
}

const session = computed(() => sessions.value.find((s) => s.id === props.uid) ?? null)
const isOpen = computed(() => session.value?.status === 'open')
/** Its earlier states, newest first */
const checkpoints = computed(() => {
	void revision.value
	return listCheckpoints(props.uid)
})

// ---------- What's shown: the session's tabs now, or a checkpoint's ----------

/** The checkpoint you're looking at; null shows the session as it is now */
const selectedId = ref<string | null>(null)
const selected = computed(() => checkpoints.value.find((c) => c.id === selectedId.value) ?? null)
/** The session's tabs: as stored, with your latest edits on top until they are saved */
const content = shallowRef<SessionContent | null>(null)
const checkpointData = shallowRef<SessionContent | null>(null)
const shown = computed(() => (selectedId.value ? checkpointData.value : content.value))

watch(selectedId, async (id) => {
	checkpointData.value = null
	const data = id ? await getContent(id) : null
	if (selectedId.value === id) checkpointData.value = data
})
// A checkpoint pushed out of History while you look at it
watch(checkpoints, () => {
	if (selectedId.value && !selected.value) selectedId.value = null
})

/** Edits sent to be saved and not yet saved; until then, what is stored is behind what's shown */
const unsaved = ref(0)
let saving: Promise<void> = Promise.resolve()
let loads = 0
async function loadContent() {
	const load = ++loads
	const id = session.value?.contentId
	const data = id ? await getContent(id) : session.value ? emptyContent() : null
	if (load !== loads || unsaved.value) return
	// The copy shown is what was stored: keep it, so Undo still finds its tabs
	if (data && content.value && sameContent(data, content.value)) return
	content.value = data
}
watch(
	() => [props.uid, session.value?.contentId],
	() => void loadContent(),
	{ immediate: true },
)

// ---------- Editing a closed session: each edit saves at once, with Undo ----------

const canEdit = computed(() => !!session.value && !isOpen.value && !selectedId.value)
const editToasts = new Set<string | number>()
function dismissEditToasts() {
	for (const id of editToasts) toast.dismiss(id)
	editToasts.clear()
}

/** Show an edit, and save it after the edits before it, in order */
function commit(next: SessionContent) {
	const id = props.uid
	content.value = next
	const data = JSON.parse(JSON.stringify(next)) as SessionContent
	unsaved.value++
	saving = saving
		.then(() => saveEdits(id, data))
		.catch((error) => {
			toast.error(
				`Couldn't save that change: ${error instanceof Error ? error.message : error}`,
			)
		})
		.finally(() => {
			unsaved.value--
			if (!unsaved.value) void loadContent()
		})
}

/** Edits made before an action reach the library before it runs */
const afterSaving = <T,>(action: () => Promise<T>) => saving.then(action)

function apply(edit: Edit, message: string) {
	if (!canEdit.value || edit.data === content.value) return
	const id = props.uid
	commit(edit.data)
	const toastId = toast(message, {
		action: {
			label: 'Undo',
			onClick: () => {
				if (props.uid === id && !isOpen.value && content.value)
					commit(edit.undo(content.value))
			},
		},
		onDismiss: () => editToasts.delete(toastId),
		onAutoClose: () => editToasts.delete(toastId),
	})
	editToasts.add(toastId)
}

const tabLabel = (tab: SavedTab) => `“${tab.title || getDisplayUrl(tab.url)}”`
const groupLabel = (group: SavedGroup) => (group.title ? `“${group.title}”` : 'the unnamed group')
const groupSize = (group: SavedGroup) =>
	content.value?.tabs.filter((t) => t.groupId === group.id).length ?? 0

function onRemoveTab(tab: SavedTab) {
	if (content.value) apply(removeTab(content.value, tab), `Removed ${tabLabel(tab)}`)
}
function onRemoveGroup(group: SavedGroup) {
	if (!content.value) return
	const tabs = pluralize(groupSize(group), 'tab')
	apply(removeGroup(content.value, group), `Removed ${groupLabel(group)} and its ${tabs}`)
}
function onUngroup(group: SavedGroup) {
	if (content.value) apply(ungroup(content.value, group), `Ungrouped ${groupLabel(group)}`)
}
const renamingGroup = ref<SavedGroup | null>(null)
const groupTitle = ref('')
watch(
	() => props.uid,
	() => {
		selectedId.value = null
		renamingGroup.value = null
		dismissEditToasts()
	},
)
onUnmounted(dismissEditToasts)
function startGroupRename(group: SavedGroup) {
	renamingGroup.value = group
	groupTitle.value = group.title
}
function commitGroupRename() {
	const group = renamingGroup.value
	renamingGroup.value = null
	if (!group || !content.value) return
	const title = groupTitle.value.trim()
	apply(
		renameGroup(content.value, group, title),
		title
			? `Renamed ${groupLabel(group)} to “${title}”`
			: `Cleared the name of ${groupLabel(group)}`,
	)
}

// ---------- Layout: windows, then groups and loose tabs in strip order ----------

type Block = { kind: 'group'; group: SavedGroup; tabs: SavedTab[] } | { kind: 'tab'; tab: SavedTab }

const windows = computed(() => {
	const d = shown.value
	if (!d) return []
	const groups = new Map(d.groups.map((g) => [g.id, g]))
	const byWindow = new Map<number, Block[]>()
	for (const tab of d.tabs) {
		const blocks = byWindow.get(tab.windowId) ?? []
		const group = groups.get(tab.groupId)
		const last = blocks.at(-1)
		if (group && last?.kind === 'group' && last.group.id === group.id) last.tabs.push(tab)
		else if (group) blocks.push({ kind: 'group', group, tabs: [tab] })
		else blocks.push({ kind: 'tab', tab })
		byWindow.set(tab.windowId, blocks)
	}
	return [...byWindow.values()].map((blocks, i) => ({
		label: `Window ${i + 1}`,
		count: blocks.reduce((n, b) => n + (b.kind === 'group' ? b.tabs.length : 1), 0),
		blocks,
	}))
})

const GROUP_DOT: Record<string, string> = {
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

// ---------- History ----------

/** What each checkpoint is. Most hold the session as it was just before the change named. */
const REASONS: Record<CheckpointReason, string> = {
	autosave: 'Kept automatically as it changed',
	manual: 'A checkpoint you saved',
	restore: 'Before an older state was restored',
	edit: 'Before your edits',
	moved: 'Before tabs were moved in',
	'keep-open': 'Before you kept what was open',
	upgrade: 'As it was before this update',
	import: 'Before a backup was imported',
	switch: 'Saved when you switched away',
	close: 'Saved when you put it away',
	park: 'Saved when its tabs were parked',
	migrated: 'Moved in from your old sessions',
}
const reasonOf = (reason: string) => REASONS[reason as CheckpointReason] ?? 'An earlier state'
const relative = (ts: number) => timeAgo(ts)
/** "Just now", "2 hours ago": a History row starts with it */
const when = (ts: number) => relative(ts).replace(/^./, (c) => c.toUpperCase())
const exact = (ts: number) => (ts ? format(ts, 'EEE, MMM d yyyy · h:mm a') : '')

function confirmRestore() {
	const checkpoint = selected.value
	if (!checkpoint || !session.value) return
	const run = async () => {
		await afterSaving(() => restoreCheckpoint(props.uid, checkpoint.id))
		selectedId.value = null
	}
	if (!isOpen.value) return void run()
	triggerConfirm(() => void run(), {
		title: `Restore this state of ${session.value.name}?`,
		message: `Your open windows will change to it. The tabs open now are kept in History, then closed, and these ${pluralize(checkpoint.tabCount, 'tab')} open in their place.`,
		confirmLabel: 'Restore and reopen',
		destructive: false,
	})
}

// ---------- Name and notes ----------

const editingMeta = ref(false)
const meta = reactive({ name: '', notes: '' })
function openMeta() {
	meta.name = session.value?.name ?? ''
	meta.notes = session.value?.description ?? ''
	editingMeta.value = true
}
async function saveMeta() {
	if (meta.name.trim() && meta.name.trim() !== session.value?.name)
		await rename(props.uid, meta.name.trim())
	if (meta.notes !== session.value?.description) await setNotes(props.uid, meta.notes)
	editingMeta.value = false
}

function confirmDelete() {
	if (!session.value) return
	triggerConfirm(
		async () => {
			await afterSaving(() => remove(props.uid))
			void router.push({ name: 'sessions' })
		},
		{
			title: 'Delete this session?',
			message: `“${session.value.name}”, its ${pluralize(session.value.tabCount, 'tab')} and its History will be removed.`,
			confirmLabel: 'Delete',
		},
	)
}
</script>

<template>
	<div v-if="session" class="page-container flex-1 py-8">
		<PageHeader :title="session.name">
			<template #breadcrumb>
				<router-link
					:to="{ name: 'sessions' }"
					class="hover:text-slate-900 dark:hover:text-white"
				>
					Sessions
				</router-link>
				<ChevronRightIcon class="size-3.5 opacity-60" aria-hidden="true" />
				<span>{{ isOpen ? 'Open now' : `Last used ${relative(lastUsed(session))}` }}</span>
			</template>
			<template #description>
				{{ pluralize(session.tabCount, 'tab') }}
				<span v-if="session.description" class="mt-1 block">{{ session.description }}</span>
			</template>
			<template #actions>
				<template v-if="isOpen">
					<SavedStatus />
					<span
						class="bg-papaya-900/10 text-papaya-900 rounded-full px-2.5 py-1 text-xs font-medium"
					>
						Open now
					</span>
				</template>
				<template v-else>
					<AppButton @click="afterSaving(() => openCopy(session!.id))">
						<ArrowTopRightOnSquareIcon class="size-3.5" aria-hidden="true" />
						Open a copy
					</AppButton>
					<AppButton
						v-if="session.status !== 'archived'"
						intent="primary"
						@click="afterSaving(() => switchTo(session!.id))"
					>
						<ArrowsRightLeftIcon class="size-3.5" aria-hidden="true" />
						Switch to
					</AppButton>
				</template>
				<Menu as="div" class="relative">
					<MenuButton :class="button({ square: true })" title="More">
						<EllipsisHorizontalIcon class="size-4" aria-hidden="true" />
						<span class="sr-only">More actions</span>
					</MenuButton>
					<AppMenuItems width="w-52">
						<AppMenuItem :icon="PencilIcon" @click="openMeta"
							>Name and notes…</AppMenuItem
						>
						<template v-if="!isOpen && session.kind !== 'home'">
							<AppMenuItem
								v-if="session.status === 'archived'"
								:icon="ArrowUturnLeftIcon"
								@click="unarchive(session.id)"
							>
								Unarchive
							</AppMenuItem>
							<AppMenuItem
								v-else
								:icon="ArchiveBoxArrowDownIcon"
								@click="archive(session.id)"
							>
								Archive
							</AppMenuItem>
							<div class="menu-separator" />
							<AppMenuItem :icon="TrashIcon" danger @click="confirmDelete"
								>Delete…</AppMenuItem
							>
						</template>
					</AppMenuItems>
				</Menu>
			</template>
		</PageHeader>

		<AppModal v-model="editingMeta" title="Name and notes">
			<form class="space-y-4" @submit.prevent="saveMeta">
				<AppInput id="session-name" v-model="meta.name" type="text" label="Name" />
				<AppTextarea
					id="session-notes"
					v-model="meta.notes"
					label="Notes"
					placeholder="What were you working on?"
					rows="3"
					name="notes"
				/>
				<div class="flex justify-end gap-2 pt-1">
					<AppButton @click="editingMeta = false">Cancel</AppButton>
					<AppButton intent="primary" type="submit">Save</AppButton>
				</div>
			</form>
		</AppModal>

		<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="min-w-0 space-y-4">
				<div
					v-if="selected"
					class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
				>
					<span class="min-w-0 flex-1">
						<span class="font-medium">{{ reasonOf(selected.reason) }}</span>
						· {{ exact(selected.createdAt) }} ·
						{{ pluralize(selected.tabCount, 'tab') }}
					</span>
					<AppButton size="xs" intent="primary" @click="confirmRestore">
						Restore
					</AppButton>
					<AppButton size="xs" @click="openCopy(session.id, selected.id)">
						Open a copy
					</AppButton>
					<AppButton size="xs" intent="ghost" @click="selectedId = null">
						Back to now
					</AppButton>
				</div>
				<template v-else-if="isOpen">
					<UnlinkedBanner />
					<p
						v-if="!needsChoice"
						class="dark:border-vercel-accents-2 dark:text-vercel-accents-6 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:bg-black"
					>
						This session is open: these are the tabs in your windows, as last saved.
						Papaya saves them as you change them.
					</p>
				</template>
				<p v-else-if="canEdit" class="dark:text-vercel-accents-5 text-xs text-slate-500">
					Remove tabs or groups, or rename a group. Each change saves at once, and you can
					undo it.
				</p>

				<section v-for="win in windows" :key="win.label" class="card overflow-clip">
					<h2
						class="dark:border-vercel-accents-2 dark:bg-vercel-accents-1 flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium"
					>
						{{ win.label }}
						<span
							class="dark:text-vercel-accents-5 font-normal tabular-nums text-slate-500"
						>
							{{ pluralize(win.count, 'tab') }}
						</span>
					</h2>
					<ul
						role="list"
						class="dark:divide-vercel-accents-2/60 divide-y divide-slate-100"
					>
						<template v-for="(block, b) in win.blocks" :key="b">
							<li v-if="block.kind === 'group'">
								<div class="group/g flex items-center gap-2 px-4 py-2">
									<span
										class="size-2.5 shrink-0 rounded-full"
										:class="GROUP_DOT[block.group.color] ?? GROUP_DOT.grey"
									/>
									<input
										v-if="renamingGroup === block.group"
										v-model="groupTitle"
										autofocus
										class="field h-7 max-w-xs px-2"
										aria-label="Group name"
										@keyup.enter="commitGroupRename"
										@keyup.esc="renamingGroup = null"
										@blur="commitGroupRename"
									/>
									<span v-else class="text-sm font-semibold">
										{{ block.group.title || 'Unnamed group' }}
									</span>
									<span class="dark:text-vercel-accents-5 text-xs text-slate-500">
										{{ pluralize(block.tabs.length, 'tab') }}
									</span>
									<div
										v-if="canEdit"
										class="ml-auto flex gap-1 opacity-0 focus-within:opacity-100 group-hover/g:opacity-100"
									>
										<AppButton
											size="xs"
											intent="ghost"
											@click="startGroupRename(block.group)"
										>
											Rename
										</AppButton>
										<AppButton
											size="xs"
											intent="ghost"
											@click="onUngroup(block.group)"
										>
											Ungroup
										</AppButton>
										<AppButton
											size="xs"
											intent="danger-ghost"
											@click="onRemoveGroup(block.group)"
										>
											Remove group
										</AppButton>
									</div>
								</div>
								<ul role="list" class="pb-1">
									<li
										v-for="(tab, t) in block.tabs"
										:key="t"
										class="group/t flex items-center gap-3 py-1.5 pl-8 pr-3"
									>
										<TabFavicon :src="tab.favIconUrl" :url="tab.url" />
										<a
											:href="tab.url"
											target="_blank"
											rel="noreferrer"
											class="min-w-0 flex-1 truncate text-sm hover:underline"
											:title="tab.url"
										>
											{{ tab.title || getDisplayUrl(tab.url) }}
										</a>
										<span
											class="dark:text-vercel-accents-5 hidden max-w-[16rem] truncate text-xs text-slate-400 sm:block"
										>
											{{ getDisplayUrl(tab.url) }}
										</span>
										<AppButton
											v-if="canEdit"
											intent="ghost"
											size="xs"
											square
											class="opacity-0 focus-visible:opacity-100 group-hover/t:opacity-100"
											title="Remove this tab"
											@click="onRemoveTab(tab)"
										>
											<XMarkIcon class="size-3.5" aria-hidden="true" />
											<span class="sr-only">Remove this tab</span>
										</AppButton>
									</li>
								</ul>
							</li>
							<li v-else class="group/t flex items-center gap-3 px-4 py-1.5">
								<TabFavicon :src="block.tab.favIconUrl" :url="block.tab.url" />
								<a
									:href="block.tab.url"
									target="_blank"
									rel="noreferrer"
									class="min-w-0 flex-1 truncate text-sm hover:underline"
									:title="block.tab.url"
								>
									{{ block.tab.title || getDisplayUrl(block.tab.url) }}
								</a>
								<span
									class="dark:text-vercel-accents-5 hidden max-w-[16rem] truncate text-xs text-slate-400 sm:block"
								>
									{{ getDisplayUrl(block.tab.url) }}
								</span>
								<AppButton
									v-if="canEdit"
									intent="ghost"
									size="xs"
									square
									class="opacity-0 focus-visible:opacity-100 group-hover/t:opacity-100"
									title="Remove this tab"
									@click="onRemoveTab(block.tab)"
								>
									<XMarkIcon class="size-3.5" aria-hidden="true" />
									<span class="sr-only">Remove this tab</span>
								</AppButton>
							</li>
						</template>
					</ul>
				</section>
				<div v-if="shown && !shown.tabs.length" class="card">
					<EmptyState
						compact
						:icon="BookmarkIcon"
						title="No tabs"
						:description="
							selected
								? 'This checkpoint has no tabs.'
								: 'Nothing is saved in this session yet.'
						"
					/>
				</div>

				<section v-if="sessionStashed.length" aria-labelledby="stashed-h">
					<h2 id="stashed-h" class="section-label mb-1 mt-8">
						Stashed groups · {{ sessionStashed.length }}
					</h2>
					<p class="dark:text-vercel-accents-5 mb-2 text-xs text-slate-500">
						Put away in this session. They stay as they are until you open or delete
						them, and aren't part of its History.
					</p>
					<ul
						role="list"
						class="card dark:divide-vercel-accents-2/60 divide-y divide-slate-100"
					>
						<li v-for="item in sessionStashed" :key="item.id">
							<details
								@toggle="
									toggleStash(item.id, ($event.target as HTMLDetailsElement).open)
								"
							>
								<summary
									class="dark:hover:bg-vercel-accents-1 flex cursor-pointer list-none items-center gap-2 px-4 py-2 hover:bg-slate-50"
								>
									<span
										class="size-2.5 shrink-0 rounded-full"
										:class="GROUP_DOT[item.color] ?? GROUP_DOT.grey"
									/>
									<span class="min-w-0 flex-1 truncate text-sm font-semibold">
										{{ item.name }}
									</span>
									<span class="dark:text-vercel-accents-5 text-xs text-slate-500">
										{{ pluralize(item.tabCount, 'tab') }} · stashed
										{{ relative(item.createdAt) }}
									</span>
									<AppButton
										v-if="isOpen"
										size="xs"
										@click.prevent="openStashed(item.id)"
									>
										Open
									</AppButton>
									<AppButton
										intent="ghost"
										size="xs"
										square
										:title="`Delete ${item.name}`"
										@click.prevent="deleteStashed(item.id)"
									>
										<TrashIcon class="size-3.5" aria-hidden="true" />
										<span class="sr-only">Delete {{ item.name }}</span>
									</AppButton>
								</summary>
								<ul role="list" class="pb-2">
									<li
										v-for="(tab, i) in stashTabs.get(item.id) ?? []"
										:key="i"
										class="flex items-center gap-3 py-1.5 pl-8 pr-4"
									>
										<TabFavicon :src="tab.favIconUrl" :url="tab.url" />
										<a
											:href="tab.url"
											target="_blank"
											rel="noreferrer"
											class="min-w-0 flex-1 truncate text-sm hover:underline"
											:title="tab.url"
										>
											{{ tab.title || getDisplayUrl(tab.url) }}
										</a>
									</li>
								</ul>
							</details>
						</li>
					</ul>
				</section>
			</div>

			<aside aria-labelledby="history-h">
				<h2 id="history-h" class="section-label mb-2">History</h2>
				<ol
					role="list"
					class="card dark:divide-vercel-accents-2/60 divide-y divide-slate-100"
				>
					<li>
						<button
							type="button"
							class="dark:hover:bg-vercel-accents-1 relative w-full px-3 py-2 text-left hover:bg-slate-50"
							:class="!selectedId ? 'dark:bg-vercel-accents-1 bg-slate-50' : ''"
							:aria-current="!selectedId ? 'true' : undefined"
							@click="selectedId = null"
						>
							<span
								v-if="!selectedId"
								class="bg-papaya-900 absolute inset-y-1.5 left-0 w-0.5 rounded-full"
								aria-hidden="true"
							/>
							<span class="flex items-center gap-2 text-sm">
								<span class="font-medium">Now</span>
								<span
									class="dark:text-vercel-accents-5 ml-auto text-xs tabular-nums text-slate-500"
								>
									{{ pluralize(session.tabCount, 'tab') }}
								</span>
							</span>
							<span class="dark:text-vercel-accents-5 block text-xs text-slate-500">
								<template v-if="!isOpen">What it reopens to</template>
								<template v-else-if="needsChoice">
									Last saved {{ relative(session.updatedAt) || 'never' }}
								</template>
								<template v-else>What's open, as last saved</template>
							</span>
						</button>
					</li>
					<li v-for="checkpoint in checkpoints" :key="checkpoint.id">
						<button
							type="button"
							class="dark:hover:bg-vercel-accents-1 relative w-full px-3 py-2 text-left hover:bg-slate-50"
							:class="
								selectedId === checkpoint.id
									? 'dark:bg-vercel-accents-1 bg-slate-50'
									: ''
							"
							:aria-current="selectedId === checkpoint.id ? 'true' : undefined"
							@click="selectedId = checkpoint.id"
						>
							<span
								v-if="selectedId === checkpoint.id"
								class="bg-papaya-900 absolute inset-y-1.5 left-0 w-0.5 rounded-full"
								aria-hidden="true"
							/>
							<span class="flex items-center gap-2 text-sm">
								<time :title="exact(checkpoint.createdAt)">{{
									when(checkpoint.createdAt)
								}}</time>
								<span
									class="dark:text-vercel-accents-5 ml-auto text-xs tabular-nums text-slate-500"
								>
									{{ pluralize(checkpoint.tabCount, 'tab') }}
								</span>
							</span>
							<span class="dark:text-vercel-accents-5 block text-xs text-slate-500">
								{{ reasonOf(checkpoint.reason) }}
							</span>
						</button>
					</li>
				</ol>
				<p class="dark:text-vercel-accents-5 mt-2 text-xs text-slate-500">
					<template v-if="checkpoints.length">
						Earlier states, newest first. Papaya keeps the last 10.
					</template>
					<template v-else>
						No earlier states yet. Papaya keeps them here as this session changes.
					</template>
				</p>
			</aside>
		</div>
	</div>
	<div v-else-if="openError" class="page-container py-8">
		<LibraryError class="max-w-xl" />
	</div>
	<div v-else-if="ready" class="page-container py-8">
		<div class="card">
			<EmptyState
				:icon="BookmarkIcon"
				title="Session not found"
				description="It may have been deleted."
			>
				<template #actions>
					<router-link :to="{ name: 'sessions' }" :class="button({ size: 'sm' })">
						Back to sessions
					</router-link>
				</template>
			</EmptyState>
		</div>
	</div>
</template>
