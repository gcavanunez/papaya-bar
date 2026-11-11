<script setup lang="ts">
/**
 * One session: its tabs (by window and group), its versions, and edits. Edits to a
 * closed session collect in a draft and save as one new version; older versions can be
 * previewed and restored.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
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
import type { VersionData, VersionGroup, VersionReason, VersionTab } from '@/lib/library/model'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import AppModal from '@/components/AppModal.vue'
import AppInput from '@/components/forms/AppInput.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const props = defineProps<{ uid: string }>()
const router = useRouter()
const { triggerConfirm } = useGlobalConfirm()
const {
	ready,
	sessions,
	revision,
	lastUsed,
	getVersionData,
	listVersions,
	switchTo,
	openCopy,
	saveVersion,
	rename,
	setNotes,
	archive,
	unarchive,
	remove,
	restoreOlder,
	saveEdits,
} = useLibrary()

const session = computed(() => sessions.value.find((s) => s.id === props.uid) ?? null)
const isOpen = computed(() => session.value?.status === 'open')
const versions = computed(() => {
	void revision.value
	return listVersions(props.uid)
})

/** null shows the newest version */
const selectedVersionId = ref<string | null>(null)
const shownVersionId = computed(() => selectedVersionId.value ?? session.value?.headVersionId ?? '')
const data = ref<VersionData | null>(null)
watch(
	shownVersionId,
	async (id) => {
		data.value = id ? await getVersionData(id) : null
	},
	{ immediate: true },
)
watch(
	() => props.uid,
	() => {
		selectedVersionId.value = null
		draft.value = null
	},
)

// ---------- Editing (closed sessions, newest version) ----------

const draft = ref<VersionData | null>(null)
const changes = ref(0)
const canEdit = computed(() => !!session.value && !isOpen.value && !selectedVersionId.value)
const shown = computed(() => draft.value ?? data.value)

function edit(change: (d: VersionData) => void) {
	if (!data.value || !canEdit.value) return
	draft.value ??= structuredClone(JSON.parse(JSON.stringify(data.value))) as VersionData
	change(draft.value)
	changes.value++
}
const removeTab = (index: number) => edit((d) => d.tabs.splice(index, 1))
const removeGroup = (groupId: number) =>
	edit((d) => {
		d.tabs = d.tabs.filter((t) => t.groupId !== groupId)
		d.groups = d.groups.filter((g) => g.id !== groupId)
	})
const ungroup = (groupId: number) =>
	edit((d) => {
		d.tabs.forEach((t) => {
			if (t.groupId === groupId) t.groupId = -1
		})
		d.groups = d.groups.filter((g) => g.id !== groupId)
	})
const renamingGroup = ref<number | null>(null)
const groupTitle = ref('')
function startGroupRename(group: VersionGroup) {
	renamingGroup.value = group.id
	groupTitle.value = group.title
}
function commitGroupRename() {
	const id = renamingGroup.value
	renamingGroup.value = null
	if (id == null) return
	const current = shown.value?.groups.find((g) => g.id === id)
	if (current && current.title !== groupTitle.value.trim()) {
		edit((d) => {
			d.groups.find((g) => g.id === id)!.title = groupTitle.value.trim()
		})
	}
}
async function saveChanges() {
	if (!draft.value) return
	await saveEdits(props.uid, draft.value)
	draft.value = null
	changes.value = 0
}
function discard() {
	draft.value = null
	changes.value = 0
}

// ---------- Layout: windows, then groups and loose tabs in strip order ----------

type Block =
	| { kind: 'group'; group: VersionGroup; tabs: { tab: VersionTab; index: number }[] }
	| { kind: 'tab'; tab: VersionTab; index: number }

const windows = computed(() => {
	const d = shown.value
	if (!d) return []
	const groups = new Map(d.groups.map((g) => [g.id, g]))
	const byWindow = new Map<number, Block[]>()
	d.tabs.forEach((tab, index) => {
		const blocks = byWindow.get(tab.windowId) ?? []
		const group = groups.get(tab.groupId)
		const last = blocks.at(-1)
		if (group && last?.kind === 'group' && last.group.id === group.id)
			last.tabs.push({ tab, index })
		else if (group) blocks.push({ kind: 'group', group, tabs: [{ tab, index }] })
		else blocks.push({ kind: 'tab', tab, index })
		byWindow.set(tab.windowId, blocks)
	})
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

const REASONS: Record<VersionReason, string> = {
	switch: 'Saved when you switched away',
	close: 'Saved when you put it away',
	manual: 'Saved by you',
	restore: 'Restored an older version',
	edit: 'Your edits',
	park: 'Tabs parked',
	migrated: 'Moved into the library',
}
const relative = (ts: number) => timeAgo(ts)
const exact = (ts: number) => (ts ? format(ts, 'EEE, MMM d yyyy · h:mm a') : '')
const selectedVersion = computed(() => versions.value.find((v) => v.id === selectedVersionId.value))

async function restoreSelected() {
	if (!selectedVersionId.value) return
	await restoreOlder(props.uid, selectedVersionId.value)
	selectedVersionId.value = null
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
			await remove(props.uid)
			void router.push({ name: 'sessions' })
		},
		{
			title: 'Delete this session?',
			message: `“${session.value.name}” and all ${pluralize(versions.value.length, 'version')} will be removed.`,
			confirmLabel: 'Delete',
		},
	)
}
</script>

<template>
	<div v-if="session" class="page-container flex-1 py-8 pb-28">
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
				{{ pluralize(session.tabCount, 'tab') }} ·
				{{ pluralize(versions.length, 'version') }}
				<span v-if="session.description" class="mt-1 block">{{ session.description }}</span>
			</template>
			<template #actions>
				<template v-if="isOpen">
					<span
						class="bg-papaya-900/10 text-papaya-900 rounded-full px-2.5 py-1 text-xs font-medium"
					>
						Open now
					</span>
					<AppButton @click="saveVersion">
						<BookmarkIcon class="size-3.5" aria-hidden="true" />
						Save version
					</AppButton>
				</template>
				<template v-else>
					<AppButton @click="openCopy(session.id, selectedVersionId ?? undefined)">
						<ArrowTopRightOnSquareIcon class="size-3.5" aria-hidden="true" />
						Open a copy
					</AppButton>
					<AppButton
						v-if="session.status !== 'archived'"
						intent="primary"
						:disabled="!!draft"
						:title="draft ? 'Save or discard your changes first' : undefined"
						@click="switchTo(session.id)"
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
				<p
					v-if="isOpen"
					class="dark:border-vercel-accents-2 dark:text-vercel-accents-6 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:bg-black"
				>
					This session is open: its live tabs are in your windows. Below is its last saved
					version. Change the session in Chrome; it's saved when you switch away.
				</p>
				<div
					v-else-if="selectedVersion"
					class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
				>
					<span class="flex-1">
						Looking at the version from {{ exact(selectedVersion.createdAt) }}.
					</span>
					<AppButton size="xs" intent="primary" @click="restoreSelected"
						>Restore this version</AppButton
					>
					<AppButton size="xs" @click="selectedVersionId = null"
						>Back to newest</AppButton
					>
				</div>
				<p
					v-else-if="canEdit && !draft"
					class="dark:text-vercel-accents-5 text-xs text-slate-500"
				>
					Remove tabs or groups, or rename a group. Changes save as a new version.
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
										v-if="renamingGroup === block.group.id"
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
											@click="ungroup(block.group.id)"
										>
											Ungroup
										</AppButton>
										<AppButton
											size="xs"
											intent="danger-ghost"
											@click="removeGroup(block.group.id)"
										>
											Remove group
										</AppButton>
									</div>
								</div>
								<ul role="list" class="pb-1">
									<li
										v-for="{ tab, index } in block.tabs"
										:key="index"
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
											@click="removeTab(index)"
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
									@click="removeTab(block.index)"
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
						description="This version is empty."
					/>
				</div>
			</div>

			<aside aria-labelledby="versions-h">
				<h2 id="versions-h" class="section-label mb-2">Versions</h2>
				<ol
					role="list"
					class="card dark:divide-vercel-accents-2/60 divide-y divide-slate-100"
				>
					<li v-for="(version, i) in versions" :key="version.id">
						<button
							type="button"
							class="dark:hover:bg-vercel-accents-1 relative w-full px-3 py-2 text-left hover:bg-slate-50"
							:class="
								shownVersionId === version.id
									? 'dark:bg-vercel-accents-1 bg-slate-50'
									: ''
							"
							:aria-current="shownVersionId === version.id ? 'true' : undefined"
							:disabled="!!draft"
							@click="selectedVersionId = i === 0 ? null : version.id"
						>
							<span
								v-if="shownVersionId === version.id"
								class="bg-papaya-900 absolute inset-y-1.5 left-0 w-0.5 rounded-full"
								aria-hidden="true"
							/>
							<span class="flex items-center gap-2 text-sm">
								<time :title="exact(version.createdAt)">{{
									relative(version.createdAt)
								}}</time>
								<span
									v-if="i === 0"
									class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 rounded bg-slate-100 px-1.5 text-[11px] text-slate-600"
								>
									Newest
								</span>
								<span
									class="dark:text-vercel-accents-5 ml-auto text-xs tabular-nums text-slate-500"
								>
									{{ version.tabCount }}
								</span>
							</span>
							<span class="dark:text-vercel-accents-5 block text-xs text-slate-500">
								{{ REASONS[version.reason as VersionReason] ?? 'Saved' }}
							</span>
						</button>
					</li>
				</ol>
				<p class="dark:text-vercel-accents-5 mt-2 text-xs text-slate-500">
					The last 10 are kept. Restoring an older one keeps the one it replaces.
				</p>
			</aside>
		</div>

		<div
			v-if="draft"
			class="dark:border-vercel-accents-2 fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur dark:bg-black/90"
		>
			<div class="page-container flex items-center gap-3 py-3">
				<span class="flex-1 text-sm">
					{{ pluralize(changes, 'change') }} ·
					{{ pluralize(draft.tabs.length, 'tab') }} left
				</span>
				<AppButton @click="discard">Discard</AppButton>
				<AppButton intent="primary" @click="saveChanges">Save as a new version</AppButton>
			</div>
		</div>
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
