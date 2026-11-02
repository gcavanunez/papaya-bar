<script setup lang="ts">
import { debouncedRef, useEventListener, useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import {
	ArrowTopRightOnSquareIcon,
	ClockIcon,
	DocumentDuplicateIcon,
	MagnifyingGlassIcon,
} from '@heroicons/vue/16/solid'
import { format } from 'date-fns'
import { toast } from 'vue-sonner'
import { useWindowVirtualizer } from '@tanstack/vue-virtual'
import { useSettings } from '@/hooks/useSettings'
import { formatUrlAsMarkdown, copyToClipboard } from '@/utils'
import { dayLabel, getDisplayUrl, isOwnExtensionUrl, pluralize } from '@/lib/format'
import { button } from '@/lib/ui'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const search = ref('')
const debouncedSearch = debouncedRef(search, 300)

type VisitResultDTO = chrome.history.VisitItem & {
	title: string
	url: string
	lastVisitTime: number
}
type HistoryEntry = { id: string; title: string; url: string; visitTime: number }

async function getHistory(query: chrome.history.HistoryQuery) {
	const results = await chrome.history.search({
		text: query.text,
		startTime: query.startTime,
		maxResults: 0, // Retrieve as much history data as possible
	})

	const allVisits: VisitResultDTO[] = []

	for (let i = 0; i < results.length; i++) {
		const element = results[i]

		if (element.url) {
			const visits = await chrome.history.getVisits({ url: element.url })

			visits.forEach(function (visit) {
				allVisits.push({
					...visit,
					title: element.title || '',
					url: element.url || '',
					lastVisitTime: element.lastVisitTime || new Date().getTime(),
				})
			})
		}
	}

	return allVisits.toSorted((a, b) => Number(b.visitTime) - Number(a.visitTime)) // Sort by visitTime descending
}

// Newest first; back-to-back visits to the same page (reloads, redirects) collapse into one
function toEntries(visits: VisitResultDTO[]): HistoryEntry[] {
	const entries: HistoryEntry[] = []
	for (const visit of visits) {
		if (isOwnExtensionUrl(visit.url)) continue
		if (entries[entries.length - 1]?.url === visit.url) continue
		entries.push({
			id: visit.visitId,
			title: visit.title,
			url: visit.url,
			visitTime: visit.visitTime ?? 0,
		})
	}
	return entries
}

const entries = ref<HistoryEntry[]>([])
const loading = ref(true)
const now = Date.now()
const oneDay = now - 24 * 60 * 60 * 1000
const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000

const { settings, loadSettings } = useSettings()

let requestId = 0
const load = async (text: string) => {
	const id = ++requestId
	loading.value = true
	const visits = await getHistory({ text, startTime: text ? oneYearAgo : oneDay })
	if (id !== requestId) return
	entries.value = toEntries(visits)
	loading.value = false
}

onMounted(() => {
	loadSettings()
	void load('')
})
watch(debouncedSearch, (value) => void load(value))

type ListItem =
	| { type: 'day'; key: string; label: string; count: number }
	| { type: 'visit'; key: string; entry: HistoryEntry }

const listItems = computed<ListItem[]>(() => {
	const items: ListItem[] = []
	const today = new Date()
	let currentDay = ''
	let header: Extract<ListItem, { type: 'day' }> | null = null
	for (const entry of entries.value) {
		const date = new Date(entry.visitTime)
		const day = format(date, 'yyyy-MM-dd')
		if (day !== currentDay || !header) {
			currentDay = day
			header = { type: 'day', key: `day-${day}`, label: dayLabel(date, today), count: 0 }
			items.push(header)
		}
		header.count++
		items.push({ type: 'visit', key: `visit-${entry.id}`, entry })
	}
	return items
})

const ROW_HEIGHT = 44
const DAY_HEIGHT = 36
const listRef = ref<HTMLElement | null>(null)
const listOffset = ref(0)
const measureOffset = () => {
	listOffset.value = listRef.value
		? listRef.value.getBoundingClientRect().top + window.scrollY
		: 0
}
watch(listRef, () => nextTick(measureOffset))
useResizeObserver(typeof document !== 'undefined' ? document.body : null, measureOffset)
useEventListener(typeof window !== 'undefined' ? window : null, 'resize', measureOffset)

const virtualizer = useWindowVirtualizer(
	computed(() => ({
		count: listItems.value.length,
		estimateSize: (index: number) =>
			listItems.value[index]?.type === 'day' ? DAY_HEIGHT : ROW_HEIGHT,
		getItemKey: (index: number) => listItems.value[index]?.key ?? index,
		overscan: 12,
		scrollMargin: listOffset.value,
	})),
)
const virtualRows = computed(() =>
	virtualizer.value
		.getVirtualItems()
		.map((row) => ({ index: row.index, start: row.start, item: listItems.value[row.index] }))
		.filter((row) => row.item),
)
const measureRow = (el: Element | ComponentPublicInstance | null) => {
	if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}

const copyHistoryItem = (item: HistoryEntry) => {
	const content = settings.value.copyLinksInMarkdownFormat
		? formatUrlAsMarkdown(item.url, item.title)
		: `${item.title}\n${item.url}`
	copyToClipboard(content)
	toast('Link copied')
}

const openHistoryItem = (url: string) => {
	chrome.tabs.create({ url })
}

const actionClass = button({ intent: 'ghost', size: 'xs', square: true })
</script>
<template>
	<div class="page-container pt-8 pb-16">
		<PageHeader
			title="History"
			:description="
				search
					? 'Showing matching pages from the past year.'
					: 'Pages you visited in the last 24 hours.'
			"
		/>

		<div class="mt-6 flex flex-wrap items-center gap-3">
			<div class="w-full max-w-sm">
				<SearchInput v-model="search" placeholder="Search history by title or URL…" />
			</div>
			<p
				v-if="!loading && entries.length"
				class="dark:text-vercel-accents-5 text-sm text-slate-500 tabular-nums"
			>
				{{ pluralize(entries.length, 'page') }}
			</p>
			<p v-else-if="loading" class="dark:text-vercel-accents-5 text-sm text-slate-500">
				Loading…
			</p>
		</div>

		<div v-if="listItems.length" ref="listRef" class="card mt-4 overflow-clip">
			<div
				class="relative -mb-px w-full"
				:style="{ height: `${virtualizer.getTotalSize()}px` }"
			>
				<div
					v-for="vRow in virtualRows"
					:key="vRow.item.key"
					:ref="measureRow"
					:data-index="vRow.index"
					class="absolute top-0 left-0 w-full"
					:style="{ transform: `translateY(${vRow.start - listOffset}px)` }"
				>
					<div
						v-if="vRow.item.type === 'day'"
						class="dark:border-vercel-accents-2 dark:bg-vercel-accents-1 flex h-9 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4"
					>
						<span class="text-[13px] font-semibold text-slate-900 dark:text-white">
							{{ vRow.item.label }}
						</span>
						<span
							class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 rounded-full bg-slate-200/70 px-1.5 py-px text-[11px] font-medium text-slate-600 tabular-nums"
						>
							{{ vRow.item.count }}
						</span>
					</div>
					<div
						v-else
						class="group dark:border-vercel-accents-2/60 dark:hover:bg-vercel-accents-1 flex h-11 items-center gap-3 border-b border-slate-100 pr-2 pl-4 transition-colors hover:bg-slate-50"
					>
						<time
							class="dark:text-vercel-accents-4 w-14 shrink-0 text-xs text-slate-400 tabular-nums"
							:datetime="new Date(vRow.item.entry.visitTime).toISOString()"
						>
							{{ format(vRow.item.entry.visitTime, 'h:mm a') }}
						</time>
						<TabFavicon :url="vRow.item.entry.url" />
						<a
							:href="vRow.item.entry.url"
							class="flex min-w-0 flex-1 items-baseline gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
							:title="vRow.item.entry.url"
							@click.prevent="openHistoryItem(vRow.item.entry.url)"
						>
							<span
								class="min-w-0 shrink truncate text-sm font-medium text-slate-900 group-hover:underline group-hover:decoration-slate-300 group-hover:underline-offset-2 dark:text-white dark:group-hover:decoration-white/30"
							>
								{{ vRow.item.entry.title || getDisplayUrl(vRow.item.entry.url) }}
							</span>
							<span
								class="dark:text-vercel-accents-4 min-w-24 flex-1 truncate text-xs text-slate-400"
							>
								{{ getDisplayUrl(vRow.item.entry.url) }}
							</span>
						</a>
						<div
							class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
						>
							<button
								type="button"
								:class="actionClass"
								title="Copy link"
								@click="copyHistoryItem(vRow.item.entry)"
							>
								<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
								<span class="sr-only">Copy link</span>
							</button>
							<button
								type="button"
								:class="actionClass"
								title="Open in new tab"
								@click="openHistoryItem(vRow.item.entry.url)"
							>
								<ArrowTopRightOnSquareIcon class="size-3.5" aria-hidden="true" />
								<span class="sr-only">Open in new tab</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div v-else-if="!loading" class="card mt-4">
			<EmptyState
				:icon="search ? MagnifyingGlassIcon : ClockIcon"
				:title="search ? 'No matching pages' : 'No history yet'"
				:description="
					search
						? 'Try a different word, or part of the address.'
						: 'Pages you visit in the last 24 hours will show up here.'
				"
			/>
		</div>
	</div>
</template>
