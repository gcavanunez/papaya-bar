<!-- button.vue -->
<script setup lang="ts">
import { cva, cx, type VariantProps } from 'class-variance-authority'

const button = cva('transition  min-w-[70px] border focus:outline-none ', {
	variants: {
		intent: {
			primary: cx(
				// colors | secondary
				'dark:bg-white bg-black dark:border-white dark:text-black ',
				// colors | secondary | hover
				'dark:hover:text-white dark:hover:bg-black',
				// colors | secondary | focus
				'dark:focus-visible:bg-black dark:focus-visible:text-white dark:focus-visible:ring',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
			secondary: cx(
				// colors | secondary
				'dark:bg-black bg-white dark:border-vercel-accents-2 dark:text-vercel-accents-5 ',
				// colors | secondary | hover
				'dark:hover:border-white dark:hover:text-white',
				// colors | secondary | focus
				'dark:focus-visible:border-white dark:focus-visible:text-white dark:focus-visible:ring',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
			'primary-ghost': cx(
				// colors | secondary
				'dark:bg-transparent bg-black dark:border-transparent dark:text-white ',
				// colors | secondary | hover
				'dark:hover:bg-vercel-accents-1',
				// colors | secondary | focus
				'dark:focus-visible:bg-vercel-accents-1 dark:focus-visible:ring ',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
			'secondary-ghost': cx(
				// colors | secondary
				'dark:bg-transparent bg-black dark:border-transparent dark:text-vercel-accents-5 ',
				// colors | secondary | hover
				'dark:hover:bg-vercel-accents-1',
				// colors | secondary | focus
				'dark:focus-visible:bg-vercel-accents-1 dark:focus-visible:ring ',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
		},
		size: {
			'x-small': 'rounded-full h-6 text-xs leading-0 py-1 px-2.5',
			small: 'rounded-full h-8 text-sm leading-0 py-1.5 px-3',
			medium: 'rounded-md  h-10 text-sm leading-0 py-2 px-4',
		},
	},
	compoundVariants: [{ intent: 'primary', size: 'medium' }],
	defaultVariants: {
		intent: 'primary',
		size: 'medium',
	},
})

type ButtonProps = VariantProps<typeof button>

defineProps<{
	intent: ButtonProps['intent']
	size: ButtonProps['size']
}>()
</script>

<template>
	<button :class="button({ intent, size })">
		<slot />
	</button>
</template>
