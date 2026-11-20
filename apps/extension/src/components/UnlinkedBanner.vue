<script setup lang="ts">
/**
 * Shown when Chrome came back without the open session's tabs. Papaya saves nothing into
 * that session until the person reopens its tabs or keeps what's open, or Chrome brings
 * the tabs back by itself (then this goes away).
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { ExclamationTriangleIcon } from '@heroicons/vue/16/solid'
import { useLibrary } from '@/hooks/useLibrary'
import { pluralize } from '@/lib/format'
import { isOwnPage } from '@/lib/liveTabs'
import { isRealUrl } from '@/lib/library/model'
import AppButton from '@/components/AppButton.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { needsChoice, currentSession, reopenSaved, keepOpen } = useLibrary()

const name = computed(() => currentSession.value?.name ?? 'Home')
const tabCount = computed(() => currentSession.value?.tabCount ?? 0)

/** Tabs worth keeping that are open now: "Keep what's open" refuses blank tabs alone */
const realOpen = ref<number | null>(null)
async function countOpen() {
	const tabs = await chrome.tabs.query({ windowType: 'normal' })
	realOpen.value = tabs.filter(
		(tab) => !tab.pinned && !isOwnPage(tab) && isRealUrl(tab.url || tab.pendingUrl),
	).length
}
let countTimer: ReturnType<typeof setTimeout> | undefined
const recount = () => {
	clearTimeout(countTimer)
	countTimer = setTimeout(() => void countOpen(), 200)
}
const tabEvents = [
	chrome.tabs.onCreated,
	chrome.tabs.onRemoved,
	chrome.tabs.onUpdated,
] as chrome.events.Event<() => void>[]
function listen(on: boolean) {
	for (const event of tabEvents) {
		if (on) event.addListener(recount)
		else event.removeListener(recount)
	}
}
watch(
	needsChoice,
	(shown) => {
		listen(false)
		if (!shown) return
		listen(true)
		void countOpen()
	},
	{ immediate: true },
)
onUnmounted(() => {
	clearTimeout(countTimer)
	listen(false)
})

const busy = ref(false)
async function run(action: () => Promise<void>) {
	busy.value = true
	try {
		await action()
	} finally {
		busy.value = false
	}
}
const nothingToKeep = computed(() => realOpen.value === 0)
</script>

<template>
	<section
		v-if="needsChoice"
		role="status"
		class="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
		:class="compact ? 'p-3' : 'px-4 py-3'"
		aria-labelledby="unlinked-title"
	>
		<div class="flex gap-2.5">
			<ExclamationTriangleIcon
				class="mt-0.5 size-4 shrink-0 text-amber-500 dark:text-amber-400"
				aria-hidden="true"
			/>
			<div class="min-w-0 flex-1">
				<h2 id="unlinked-title" class="text-sm font-semibold">
					Chrome didn't reopen {{ name }}'s tabs
				</h2>
				<p class="mt-1 text-xs text-amber-800 dark:text-amber-300/90">
					Papaya isn't saving into {{ name }} until you choose. If Chrome brings them
					back, this goes away.
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<AppButton
						intent="primary"
						size="sm"
						:disabled="busy"
						:title="`Open ${name}'s ${pluralize(tabCount, 'saved tab')} next to what's open`"
						@click="run(reopenSaved)"
					>
						Reopen its tabs
					</AppButton>
					<AppButton size="sm" :disabled="busy || nothingToKeep" @click="run(keepOpen)">
						Keep what's open
					</AppButton>
				</div>
				<p class="mt-2 text-xs text-amber-800/80 dark:text-amber-300/70">
					<template v-if="nothingToKeep">
						Only blank tabs are open, so there's nothing to keep yet.
					</template>
					<template v-else>
						Keep what's open makes the tabs open now {{ name }}'s. The tabs it had are
						kept in its History.
					</template>
				</p>
			</div>
		</div>
	</section>
</template>
