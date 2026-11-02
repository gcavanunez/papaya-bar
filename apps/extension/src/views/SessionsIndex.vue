<script setup lang="ts">
import { computed, ref } from 'vue'
import { format, formatDistanceToNowStrict, isValid } from 'date-fns'
import { Menu, MenuButton } from '@headlessui/vue'
import {
	ArrowDownTrayIcon,
	ArrowTopRightOnSquareIcon,
	ArrowUpTrayIcon,
	BookmarkIcon,
	EllipsisHorizontalIcon,
	MagnifyingGlassIcon,
	TrashIcon,
} from '@heroicons/vue/16/solid'
import { toast } from 'vue-sonner'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { sessionDate, sessionTitle, useSessionsData, type SavedData } from '@/hooks/useSessionsData'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import { getHostname, isOwnExtensionUrl, pluralize, recencyBucket } from '@/lib/format'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const { loadedTabs } = useChromeTabs()
const { state, storeSession, openAll, removeSavedSession, downloadSavedSession, importSession } =
	useSessionsData()
const { triggerConfirm } = useGlobalConfirm()

const search = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

type SessionRow = {
	key: string
	date: Date
	data: SavedData
	title: string
	matches: number
	favicons: { src?: string; url?: string }[]
	windowCount: number
}

const sessions = computed<SessionRow[]>(() => {
	const term = search.value.trim().toLowerCase()
	return [...state.value.entries()]
		.map(([key, data]) => {
			const title = sessionTitle(data)
			const matches = term
				? data.tabs.filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(term))
						.length
				: 0
			const titleMatch = term
				? `${title} ${data.description}`.toLowerCase().includes(term)
				: false
			const seenHosts = new Set<string>()
			const favicons = data.tabs
				.filter((tab) => {
					const host = getHostname(tab.url)
					if (!host || seenHosts.has(host)) return false
					seenHosts.add(host)
					return true
				})
				.slice(0, 4)
				.map((tab) => ({ src: tab.favIconUrl, url: tab.url }))
			return {
				key,
				date: sessionDate(key),
				data,
				title,
				matches,
				favicons,
				windowCount: new Set(data.tabs.map((tab) => tab.windowId)).size,
				visible: !term || matches > 0 || titleMatch,
			}
		})
		.filter((row) => row.visible)
		.sort((a, b) => b.date.getTime() - a.date.getTime())
})

const sections = computed(() => {
	const now = new Date()
	const groups = new Map<string, { label: string; rows: SessionRow[] }>()
	for (const row of sessions.value) {
		const range = isValid(row.date)
			? recencyBucket(row.date, now)
			: { key: 'older', label: 'Older' }
		const group = groups.get(range.key) ?? { label: range.label, rows: [] }
		group.rows.push(row)
		groups.set(range.key, group)
	}
	return [...groups.values()]
})

const relative = (date: Date) =>
	isValid(date) ? formatDistanceToNowStrict(date, { addSuffix: true }) : ''
const exact = (date: Date) => (isValid(date) ? format(date, 'EEE, MMM d yyyy · h:mm a') : '')

const saveCurrent = async () => {
	const tabs = loadedTabs.value.filter((tab) => !isOwnExtensionUrl(tab.url))
	if (!tabs.length) return
	await storeSession(tabs)
	toast(`Saved ${pluralize(tabs.length, 'tab')} as a session`)
}

const confirmDelete = (row: SessionRow) => {
	triggerConfirm(() => removeSavedSession(row.key), {
		title: 'Delete this session?',
		message: `“${row.title}” and its ${pluralize(row.data.tabs.length, 'tab')} will be removed.`,
		confirmLabel: 'Delete',
	})
}

const onFileChange = async (event: Event) => {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	try {
		importSession(JSON.parse(await file.text()))
		toast('Session imported')
	} catch (e) {
		toast.error(e instanceof Error ? e.message : 'Import failed')
	}
}
</script>

<template>
	<div class="page-container py-8">
		<PageHeader
			title="Sessions"
			description="Snapshots of your tabs that you can reopen later."
		>
			<template #actions>
				<AppButton @click="fileInput?.click()">
					<ArrowUpTrayIcon class="size-4" aria-hidden="true" />
					Import
				</AppButton>
				<AppButton intent="primary" @click="saveCurrent">
					<BookmarkIcon class="size-4" aria-hidden="true" />
					Save current tabs
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

		<div v-if="state.size" class="mt-6 max-w-sm">
			<SearchInput v-model="search" placeholder="Search sessions and their tabs…" />
		</div>

		<div v-if="sections.length" class="mt-6 space-y-8">
			<section v-for="section in sections" :key="section.label">
				<h2 class="section-label mb-2">{{ section.label }}</h2>
				<ul
					role="list"
					class="card dark:divide-vercel-accents-2/60 divide-y divide-slate-100 overflow-clip"
				>
					<li
						v-for="row in section.rows"
						:key="row.key"
						class="group dark:hover:bg-vercel-accents-1 relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
					>
						<div class="flex shrink-0 -space-x-1.5">
							<span
								v-for="(icon, index) in row.favicons"
								:key="index"
								class="dark:border-vercel-accents-2 flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white dark:bg-black"
							>
								<TabFavicon :src="icon.src" :url="icon.url" />
							</span>
						</div>

						<div class="min-w-0 flex-1">
							<router-link
								:to="{ name: 'sessions.show', params: { uid: row.key } }"
								class="block truncate text-sm font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none dark:text-white"
							>
								{{ row.title }}
							</router-link>
							<p
								class="dark:text-vercel-accents-5 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500"
							>
								<span>{{ pluralize(row.data.tabs.length, 'tab') }}</span>
								<span v-if="row.windowCount > 1" aria-hidden="true">·</span>
								<span v-if="row.windowCount > 1">
									{{ pluralize(row.windowCount, 'window') }}
								</span>
								<span aria-hidden="true">·</span>
								<time :title="exact(row.date)">{{ relative(row.date) }}</time>
								<template v-if="row.data.description">
									<span aria-hidden="true">·</span>
									<span class="truncate">{{ row.data.description }}</span>
								</template>
							</p>
						</div>

						<span
							v-if="search && row.matches"
							class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
						>
							{{ pluralize(row.matches, 'match', 'matches') }}
						</span>

						<div class="relative z-10 flex shrink-0 items-center gap-1">
							<AppButton size="sm" @click="openAll(row.data)">
								<ArrowTopRightOnSquareIcon class="size-3.5" aria-hidden="true" />
								Open
							</AppButton>
							<Menu as="div" class="relative">
								<MenuButton
									:class="button({ intent: 'ghost', size: 'sm', square: true })"
									title="More"
								>
									<span class="sr-only">More actions</span>
									<EllipsisHorizontalIcon class="size-4" aria-hidden="true" />
								</MenuButton>
								<AppMenuItems width="w-48">
									<AppMenuItem
										:icon="ArrowDownTrayIcon"
										@click="downloadSavedSession(row.key, row.data)"
									>
										Download
									</AppMenuItem>
									<div class="menu-separator" />
									<AppMenuItem
										:icon="TrashIcon"
										danger
										@click="confirmDelete(row)"
									>
										Delete…
									</AppMenuItem>
								</AppMenuItems>
							</Menu>
						</div>
					</li>
				</ul>
			</section>
		</div>

		<div v-else class="card mt-6">
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
				title="No saved sessions yet"
				description="Save your open tabs as a session to close them now and reopen them later."
			>
				<template #actions>
					<AppButton intent="primary" size="sm" @click="saveCurrent">
						Save current tabs
					</AppButton>
				</template>
			</EmptyState>
		</div>
	</div>
</template>
