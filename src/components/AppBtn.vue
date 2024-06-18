<script setup lang="ts">
import { computed } from 'vue'
import clsx from 'clsx'
// const cva = clsx
const colorClasses = {
	'primary-dark': clsx(
		'inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300 shadow-sm ring-0 highlight-white/5 hover:bg-slate-700 ',
	),
	primary:
		'inline-flex items-center rounded-full bg-slate-100 active:bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5 dark:active:bg-vercel-accents-3 dark:active:text-white transition',
	white: 'inline-flex items-center rounded-full bg-white dark:bg-vercel-accents-2 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:text-white',
	'round-primary':
		'inline-flex items-center rounded-full bg-slate-100 px-1 py-1 text-xs font-medium text-slate-800 shadow-sm dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5',
	'round-white':
		'inline-flex items-center rounded-full bg-white px-1 py-1 text-xs font-medium text-slate-800 shadow-sm dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5',
	'round-dark-primary':
		'inline-flex items-center rounded-full bg-slate-800 px-1 py-1 text-xs font-medium text-slate-300 shadow-sm ring-0 highlight-white/5 hover:bg-slate-700',
	'vc-secondary': clsx(
		// all
		'transition rounded-full min-w-[70px] border',
		// size vriant - rounded-md
		'h-8 text-sm leading-0 py-1.5 px-3',
		// colors | secondary
		'dark:bg-black bg-white dark:border-vercel-accents-2 dark:text-vercel-accents-5 ',
		// colors | secondary | hover
		'dark:hover:border-white dark:hover:text-white',
		// colors | secondary | focus
		'dark:focus-visible:border-white dark:focus-visible:text-white',
		// colors | secondary | active
		'dark:active:bg-vercel-accents-2',
	),
}
type ColorType = keyof typeof colorClasses

interface Props {
	color?: ColorType
}
const props = withDefaults(defineProps<Props>(), {
	color: 'primary',
})
const btnClasses = computed(() => {
	return colorClasses[props.color]
})
</script>

<template>
	<button :class="btnClasses" v-bind="$attrs">
		<slot />
	</button>
</template>
