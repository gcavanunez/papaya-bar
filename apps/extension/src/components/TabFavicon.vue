<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getHostname } from '@/lib/format'

const props = withDefaults(
	defineProps<{
		src?: string
		/** Page URL, used for the letter fallback */
		url?: string
		size?: 'sm' | 'md' | 'lg'
	}>(),
	{
		src: '',
		url: '',
		size: 'sm',
	},
)

const failed = ref(false)
watch(
	() => props.src,
	() => (failed.value = false),
)

const letter = computed(() => {
	const host = getHostname(props.url)
	const match = host.match(/[a-z0-9]/i)
	return match ? match[0].toUpperCase() : '•'
})

const sizeClass = computed(
	() =>
		({
			sm: 'size-4 rounded-[3px] text-[9px]',
			md: 'size-5 rounded text-[10px]',
			lg: 'size-8 rounded-md text-sm',
		})[props.size],
)
</script>

<template>
	<img
		v-if="src && !failed"
		:src="src"
		alt=""
		:class="[sizeClass, 'shrink-0 object-contain']"
		loading="lazy"
		@error="failed = true"
	/>
	<span
		v-else
		aria-hidden="true"
		:class="[
			sizeClass,
			'dark:bg-vercel-accents-2 dark:text-vercel-accents-6 flex shrink-0 items-center justify-center bg-slate-200 leading-none font-semibold text-slate-500',
		]"
	>
		{{ letter }}
	</span>
</template>
