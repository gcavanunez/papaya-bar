<script setup lang="ts">
/**
 * Shown until saved sessions and contexts have moved into the library. Plans the move
 * from your current data, shows what will happen, and moves only when you click,
 * after downloading a backup. With nothing to move, it moves without asking.
 */
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { ArrowDownTrayIcon, RectangleStackIcon } from '@heroicons/vue/16/solid'
import { useLibrary } from '@/hooks/useLibrary'
import { downloadBackup } from '@/lib/dataBackup'
import { pluralize } from '@/lib/format'
import type { MigrationResult } from '@/lib/library/migrate'
import AppButton from '@/components/AppButton.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { ready, migrated, applyMove } = useLibrary()
const plan = ref<MigrationResult | null>(null)
const error = ref('')
const moving = ref(false)

watch(
	() => ready.value && !migrated.value,
	async (needed) => {
		if (!needed || plan.value) return
		try {
			const { previewMoveIn, isNothingToMove } = await import('@/lib/library/moveIn')
			const result = await previewMoveIn()
			if (isNothingToMove(result)) await applyMove(result)
			else plan.value = result
		} catch (e) {
			error.value = e instanceof Error ? e.message : String(e)
		}
	},
	{ immediate: true },
)

const lines = computed(() => {
	const report = plan.value?.report
	if (!report) return []
	const out: string[] = []
	if (report.found.savedSessions)
		out.push(`${pluralize(report.found.savedSessions, 'saved session')}`)
	if (report.found.contexts) {
		out.push(
			`${pluralize(report.found.contexts, 'context')} with ${pluralize(report.found.contextVersions, 'version')}`,
		)
	}
	out.push(`${report.created.tabs.toLocaleString()} tabs in all`)
	const dropped = report.dropped.copies + report.dropped.duplicates + report.dropped.empty
	if (dropped) {
		out.push(
			`${pluralize(dropped, 'duplicate or empty copy', 'duplicate or empty copies')} left out`,
		)
	}
	return out
})

async function move() {
	if (!plan.value) return
	moving.value = true
	try {
		await downloadBackup()
		await applyMove(plan.value)
		toast(
			`Moved ${pluralize(plan.value.report.created.sessions, 'session')} into your library`,
			{
				description: `${plan.value.report.openSession} is the open session.`,
			},
		)
	} catch (e) {
		toast.error(`The move failed, and nothing changed: ${e instanceof Error ? e.message : e}`)
	} finally {
		moving.value = false
	}
}
</script>

<template>
	<section
		v-if="ready && !migrated && (plan || error)"
		class="card space-y-3"
		:class="compact ? 'p-3' : 'p-5'"
		aria-labelledby="move-in-title"
	>
		<div class="flex items-center gap-2">
			<RectangleStackIcon class="text-papaya-900 size-4 shrink-0" aria-hidden="true" />
			<h2 id="move-in-title" class="text-sm font-semibold">
				One library for all your sessions
			</h2>
		</div>
		<template v-if="plan">
			<p class="dark:text-vercel-accents-6 text-xs text-slate-600">
				Saved sessions and contexts become one list of sessions you can switch into, each
				with its last 10 versions. Nothing is deleted: today's data stays where it is.
			</p>
			<ul
				class="dark:text-vercel-accents-6 list-disc space-y-0.5 pl-4 text-xs text-slate-600"
			>
				<li v-for="line in lines" :key="line">{{ line }}</li>
				<li>
					<strong class="font-medium">{{ plan.report.openSession }}</strong> becomes the
					open session
				</li>
			</ul>
			<AppButton intent="primary" size="sm" class="w-full" :disabled="moving" @click="move">
				<ArrowDownTrayIcon class="size-3.5" aria-hidden="true" />
				{{ moving ? 'Moving…' : 'Download a backup and move' }}
			</AppButton>
		</template>
		<p v-else class="text-xs text-red-600 dark:text-red-400">
			Couldn't read your current sessions: {{ error }}
		</p>
	</section>
</template>
