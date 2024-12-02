<script setup lang="ts">
import AppInput from '@/components/forms/AppInput.vue'
import { debouncedRef } from '@vueuse/core'
import { onMounted, ref, watch } from 'vue'

const search = ref('')
const debouncedSearch = debouncedRef(search, 500)

type MatchDTO = ReturnType<typeof matchDTO>
type VisitResultDTO = chrome.history.VisitItem & {
	title: string
	url: string
	lastVisitTime: number
}

function matchDTO(match: VisitResultDTO) {
	return {
		id: match.id,
		title: match.title,
		url: match.url,
		lastVisitTime: new Date(match.lastVisitTime || '').toLocaleString(),
		visitTime: new Date(match.visitTime || '').toLocaleString(),
	}
}
async function getHistory(query: chrome.history.HistoryQuery) {
	const results = await chrome.history.search({
		text: query.text,
		startTime: query.startTime,
		maxResults: 0, // Retrieve as much history data as possible
	})

	let allVisits: VisitResultDTO[] = []

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

const historyMatches = ref<MatchDTO[]>([])
const now = Date.now()
const oneDay = now - 24 * 60 * 60 * 1000
const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000

onMounted(() => {
	getHistory({ text: '', startTime: oneDay }).then((matches) => {
		historyMatches.value = matches.map((row) => matchDTO(row))
	})
})
watch(
	() => debouncedSearch.value,
	(newVal, oldVal) => {
		getHistory({ text: newVal, startTime: oneYearAgo, maxResults: 0 }).then((matches) => {
			historyMatches.value = matches.map((row) => matchDTO(row))
		})
	},
)
</script>
<template>
	<div class="relative">
		<div class="container mx-auto max-w-5xl px-4 py-6 sm:px-2">
			<AppInput v-model="search" label="Search" />

			<ul class="mt-8 flex flex-col gap-2">
				<li
					v-for="historyItem in historyMatches"
					:key="historyItem.id"
					class="group w-full py-2"
				>
					<div
						class="relative overflow-hidden rounded-lg border-l-4 shadow-sm ring-1 ring-black ring-opacity-5 transition dark:ring-vercel-accents-2"
					>
						<div class="flex w-full flex-col px-2 py-2">
							<div class="inline-flex gap-2">
								<span class="shrink-0">{{ historyItem.title }}</span>
								<span>-</span>
								<span class="text-sm">{{ historyItem.url }}</span>
							</div>
							<div class="text-xs">
								{{ historyItem.visitTime }}
							</div>
						</div>
					</div>
				</li>
			</ul>
		</div>
	</div>
</template>
