<script setup lang="ts">
/**
 * The sessions library: every session in one list. Switch into any of them; Papaya
 * saves a version of the one you leave.
 */
import { computed, ref, watch } from 'vue'
import { differenceInCalendarDays, format } from 'date-fns'
import { Menu, MenuButton } from '@headlessui/vue'
import {
	ArchiveBoxArrowDownIcon,
	ArrowDownTrayIcon,
	ArrowTopRightOnSquareIcon,
	ArrowUpTrayIcon,
	ArrowUturnLeftIcon,
	ArrowsRightLeftIcon,
	BookmarkIcon,
	EllipsisHorizontalIcon,
	HomeIcon,
	MagnifyingGlassIcon,
	TrashIcon,
} from '@heroicons/vue/16/solid'
import { toast } from 'vue-sonner'
import { useLibrary } from '@/hooks/useLibrary'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import { pluralize, recencyBucket, timeAgo } from '@/lib/format'
import { savedSessionToData, type OldSavedSession } from '@/lib/library/migrate'
import { parsePreview, type VersionData } from '@/lib/library/model'
import { createSession, type SessionSummary } from '@/lib/library/store'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import EmptyState from '@/components/EmptyState.vue'
import LibraryMoveCard from '@/components/LibraryMoveCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const {
	ready,
	migrated,
	sessions,
	openSession,
	archived,
	lastUsed,
	library,
	getData,
	switchTo,
	saveCopy,
	openCopy,
	archive,
	unarchive,
	remove,
} = useLibrary()
const { triggerConfirm } = useGlobalConfirm()

const search = ref('')
const showArchived = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const query = computed(() => search.value.trim().toLowerCase())

// ---------- Searching inside sessions ----------
// Tab text lives in each session's newest version, loaded the first time you search

const tabText = ref(new Map<string, string[]>())
let loadedFor = ''
watch(query, async (q) => {
	if (q.length < 2) return
	const key = sessions.value.map((s) => s.headVersionId).join()
	if (key === loadedFor) return
	loadedFor = key
	const library_ = await library()
	const heads = sessions.value.filter((s) => s.headVersionId)
	const data = await library_.blobs.getMany(heads.map((s) => s.headVersionId))
	tabText.value = new Map(
		heads.map((s) => [
			s.id,
			(data.get(s.headVersionId)?.tabs ?? []).map((t) => `${t.title} ${t.url}`.toLowerCase()),
		]),
	)
})

interface Row {
	session: SessionSummary
	matches: number
	icons: { favIconUrl: string; url: string }[]
}

const rows = computed<Row[]>(() =>
	sessions.value
		.filter((s) => (showArchived.value ? s.status === 'archived' : s.status !== 'archived'))
		.map((session) => {
			const nameMatch =
				!query.value ||
				`${session.name} ${session.description}`.toLowerCase().includes(query.value)
			const matches =
				query.value.length >= 2
					? (tabText.value.get(session.id) ?? []).filter((t) => t.includes(query.value))
							.length
					: 0
			return { session, matches, icons: parsePreview(session.preview), nameMatch }
		})
		.filter((row) => row.nameMatch || row.matches > 0),
)

/** "Open now" first, then by when each session was last used */
const sections = computed(() => {
	const now = new Date()
	const groups = new Map<string, { label: string; rows: Row[] }>()
	for (const row of rows.value) {
		const used = new Date(lastUsed(row.session))
		let key: string
		let label: string
		if (row.session.status === 'open') {
			;[key, label] = ['open', 'Open now']
		} else if (differenceInCalendarDays(now, used) >= 30) {
			;[key, label] = [`y${used.getFullYear()}`, String(used.getFullYear())]
		} else {
			;({ key, label } = recencyBucket(used, now))
		}
		const group = groups.get(key) ?? { label, rows: [] }
		group.rows.push(row)
		groups.set(key, group)
	}
	const open = groups.get('open')
	groups.delete('open')
	return open ? [open, ...groups.values()] : [...groups.values()]
})

const relative = (ts: number) => timeAgo(ts)
const exact = (ts: number) => (ts ? format(ts, 'EEE, MMM d yyyy · h:mm a') : '')

// ---------- Actions ----------

const confirmDelete = (session: SessionSummary) => {
	triggerConfirm(() => void remove(session.id), {
		title: 'Delete this session?',
		message: `“${session.name}”, its ${pluralize(session.tabCount, 'tab')} and all its versions will be removed.`,
		confirmLabel: 'Delete',
	})
}

async function download(session: SessionSummary) {
	const data = await getData(session.id)
	const json = JSON.stringify({ title: session.name, description: session.description, ...data })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
	a.download = `papaya-session-${session.name.replace(/[^\w]+/g, '-').toLowerCase()}.json`
	a.click()
	a.remove()
}

async function onFileChange(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	try {
		const parsed = JSON.parse(await file.text()) as OldSavedSession
		const data: VersionData = savedSessionToData(parsed)
		const name = parsed.title?.trim() || file.name.replace(/\.json$/, '')
		await createSession(await library(), { name, description: parsed.description ?? '' }, data)
		toast(`Imported ${name}`)
	} catch (e) {
		toast.error(e instanceof Error ? e.message : 'Import failed')
	}
}
</script>

<template>
	<div class="page-container py-8">
		<PageHeader
			title="Sessions"
			description="Everything you've worked on. Switch into any session; the one you leave is saved as you left it."
		>
			<template #actions>
				<AppButton @click="fileInput?.click()">
					<ArrowUpTrayIcon class="size-4" aria-hidden="true" />
					Import
				</AppButton>
				<AppButton
					intent="primary"
					:disabled="!migrated"
					title="Save your open tabs as a new session; they stay open"
					@click="saveCopy()"
				>
					<BookmarkIcon class="size-4" aria-hidden="true" />
					Save open tabs
				</AppButton>
				<input
					ref="fileInput"
					type="file"
					accept="application/json,.json"
					class="hidden"
					@change="onFileChange"
				/>
			</template>
		</PageHeader>

		<div class="mt-6 max-w-xl">
			<LibraryMoveCard />
		</div>

		<template v-if="migrated">
			<div class="mt-6 flex flex-wrap items-center gap-3">
				<div class="w-full max-w-sm">
					<SearchInput
						v-model="search"
						placeholder="Search sessions and the tabs in them…"
					/>
				</div>
				<button
					v-if="archived.length || showArchived"
					type="button"
					class="dark:text-vercel-accents-5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
					:aria-pressed="showArchived"
					@click="showArchived = !showArchived"
				>
					{{ showArchived ? '← All sessions' : `Archived (${archived.length})` }}
				</button>
			</div>

			<div v-if="sections.length" class="mt-6 space-y-8">
				<section v-for="section in sections" :key="section.label">
					<h2 class="section-label mb-2">{{ section.label }}</h2>
					<ul
						role="list"
						class="card dark:divide-vercel-accents-2/60 divide-y divide-slate-100 overflow-clip"
					>
						<li
							v-for="{ session, matches, icons } in section.rows"
							:key="session.id"
							class="dark:hover:bg-vercel-accents-1 group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
						>
							<div class="flex w-[4.5rem] shrink-0 -space-x-1.5">
								<span
									v-if="session.kind === 'home'"
									class="dark:border-vercel-accents-2 flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white dark:bg-black"
								>
									<HomeIcon class="size-3.5 text-slate-400" aria-hidden="true" />
								</span>
								<span
									v-for="(icon, index) in icons"
									:key="index"
									class="dark:border-vercel-accents-2 flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white dark:bg-black"
								>
									<TabFavicon :src="icon.favIconUrl" :url="icon.url" />
								</span>
							</div>

							<div class="min-w-0 flex-1">
								<router-link
									:to="{ name: 'sessions.show', params: { uid: session.id } }"
									class="block truncate text-sm font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none dark:text-white"
								>
									{{ session.name }}
								</router-link>
								<p
									class="dark:text-vercel-accents-5 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500"
								>
									<span>{{ pluralize(session.tabCount, 'tab') }}</span>
									<span aria-hidden="true">·</span>
									<time :title="exact(lastUsed(session))">
										{{
											session.status === 'open'
												? 'open now'
												: relative(lastUsed(session))
										}}
									</time>
									<template v-if="session.description">
										<span aria-hidden="true">·</span>
										<span class="truncate">{{ session.description }}</span>
									</template>
								</p>
							</div>

							<span
								v-if="matches"
								class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
							>
								{{ pluralize(matches, 'match', 'matches') }}
							</span>

							<div class="relative z-10 flex shrink-0 items-center gap-1">
								<span
									v-if="session.status === 'open'"
									class="bg-papaya-900/10 text-papaya-900 rounded-full px-2 py-0.5 text-[11px] font-medium"
								>
									Open
								</span>
								<AppButton
									v-else-if="session.status !== 'archived'"
									size="sm"
									:title="`Switch to ${session.name}: ${openSession?.name ?? 'the open session'} is saved and closed`"
									@click="switchTo(session.id)"
								>
									<ArrowsRightLeftIcon class="size-3.5" aria-hidden="true" />
									Switch to
								</AppButton>
								<Menu as="div" class="relative">
									<MenuButton
										:class="
											button({ intent: 'ghost', size: 'sm', square: true })
										"
										title="More"
									>
										<span class="sr-only">More actions</span>
										<EllipsisHorizontalIcon class="size-4" aria-hidden="true" />
									</MenuButton>
									<AppMenuItems width="w-52">
										<AppMenuItem
											v-if="session.status !== 'open'"
											:icon="ArrowTopRightOnSquareIcon"
											@click="openCopy(session.id)"
										>
											Open a copy
										</AppMenuItem>
										<AppMenuItem
											:icon="ArrowDownTrayIcon"
											@click="download(session)"
										>
											Download
										</AppMenuItem>
										<template
											v-if="
												session.status !== 'open' && session.kind !== 'home'
											"
										>
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
											<AppMenuItem
												:icon="TrashIcon"
												danger
												@click="confirmDelete(session)"
											>
												Delete…
											</AppMenuItem>
										</template>
									</AppMenuItems>
								</Menu>
							</div>
						</li>
					</ul>
				</section>
			</div>

			<div v-else-if="ready" class="card mt-6">
				<EmptyState
					v-if="search"
					:icon="MagnifyingGlassIcon"
					title="No matching sessions"
					:description="`No session or saved tab matches “${search}”.`"
				>
					<template #actions>
						<AppButton size="sm" @click="search = ''">Clear search</AppButton>
					</template>
				</EmptyState>
				<EmptyState
					v-else
					:icon="BookmarkIcon"
					:title="showArchived ? 'Nothing archived' : 'No sessions yet'"
					description="Save your open tabs as a session to come back to them later."
				/>
			</div>
		</template>
	</div>
</template>
