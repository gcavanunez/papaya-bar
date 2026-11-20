<script setup lang="ts">
/**
 * Shown when the sessions library could not open (its upgrade failed, or the background
 * worker did not answer), so an empty page is never mistaken for lost sessions.
 */
import { ref } from 'vue'
import { ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/vue/16/solid'
import { useLibrary } from '@/hooks/useLibrary'
import AppButton from '@/components/AppButton.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { openError, retry } = useLibrary()
const trying = ref(false)
async function tryAgain() {
	trying.value = true
	try {
		await retry()
	} finally {
		trying.value = false
	}
}
</script>

<template>
	<section
		v-if="openError"
		role="alert"
		class="card"
		:class="compact ? 'p-3' : 'p-5'"
		aria-labelledby="library-error-title"
	>
		<div class="flex gap-2.5">
			<ExclamationCircleIcon
				class="mt-0.5 size-4 shrink-0 text-red-500 dark:text-red-400"
				aria-hidden="true"
			/>
			<div class="min-w-0 flex-1">
				<h2 id="library-error-title" class="text-sm font-semibold">
					Papaya couldn't open your sessions
				</h2>
				<p class="dark:text-vercel-accents-6 mt-1 text-xs text-slate-600">
					Nothing was changed: your sessions are still stored as they were. Papaya tries
					again each time you open it.
				</p>
				<p
					class="dark:bg-vercel-accents-1 dark:text-vercel-accents-5 mt-2 break-words rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-500"
				>
					<span class="font-medium text-slate-700 dark:text-slate-200">Reason:</span>
					{{ openError }}
				</p>
				<AppButton size="sm" class="mt-3" :disabled="trying" @click="tryAgain">
					<ArrowPathIcon
						class="size-3.5"
						:class="trying ? 'animate-spin' : ''"
						aria-hidden="true"
					/>
					{{ trying ? 'Trying…' : 'Try again' }}
				</AppButton>
			</div>
		</div>
	</section>
</template>
