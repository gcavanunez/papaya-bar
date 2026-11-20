<script setup lang="ts">
/** When the open session was last saved, as a quiet fact; paused while Papaya waits for a choice */
import { computed } from 'vue'
import { useNow } from '@vueuse/core'
import { format } from 'date-fns'
import { useLibrary } from '@/hooks/useLibrary'
import { timeAgo } from '@/lib/format'

const { savedAt, needsChoice } = useLibrary()
const now = useNow({ interval: 30_000 })

const text = computed(() => {
	if (needsChoice.value) return 'Not saving until you choose'
	if (!savedAt.value) return 'Not saved yet'
	return `Saved ${timeAgo(savedAt.value, now.value.getTime())}`
})
const exact = computed(() =>
	savedAt.value ? `Last saved ${format(savedAt.value, 'EEE, MMM d yyyy · h:mm a')}` : undefined,
)
</script>

<template>
	<span
		class="text-xs"
		:class="
			needsChoice
				? 'text-amber-700 dark:text-amber-300'
				: 'dark:text-vercel-accents-5 text-slate-500'
		"
		:title="exact"
	>
		{{ text }}
	</span>
</template>
