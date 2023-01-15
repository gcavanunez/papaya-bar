<!-- button.vue -->
<script setup lang="ts">
import { cva, cx, type VariantProps } from 'class-variance-authority'
import { ButtonHTMLAttributes } from 'vue'
// font-medium

// disabled:cursor-not-allowed
// disabled:opacity-75
// disabled:bg-gray-50
// dark:disabled:bg-opacity-75

// focus:ring-offset-white
// dark:focus:ring-offset-black

// shadow-sm

// border
// u-border-gray-300
// u-text-gray-700
// bg-gray-50
// hover:bg-gray-100
// dark:bg-gray-800
// dark:hover:bg-opacity-75
// focus-visible:border-primary-500
// inline-flex
// items-center
// rounded-md
// flex-shrink-0
const button = cva('transition   border focus:outline-none dark:focus-visible:ring ', {
	variants: {
		intent: {
			primary: cx(
				// colors | secondary
				'dark:bg-white bg-black dark:border-white dark:text-black text-white ',
				// colors | secondary | hover
				'dark:hover:text-white dark:hover:bg-black hover:bg-white hover:text-black',
				// colors | secondary | focus
				'dark:focus-visible:bg-black dark:focus-visible:text-white ',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
			secondary: cx(
				// colors | secondary
				'dark:bg-black bg-white dark:border-vercel-accents-2 dark:text-vercel-accents-5 ',
				// colors | secondary | hover
				'dark:hover:border-white dark:hover:text-white',
				// colors | secondary | focus
				'dark:focus-visible:border-white dark:focus-visible:text-white ',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
			common: cx(
				'bg-slate-100 active:bg-slate-50 text-slate-800',
				'shadow-sm',
				'dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5 dark:active:bg-vercel-accents-3 dark:active:text-white dark:border-vercel-accents-3'
			),
			plain: cx(
				'border-gray-300',
				'dark:border-transparent',
				'hover:border-gray-800',
				'dark:hover:border-gray-800',
				'active:bg-gray-100',
				'bg-white',
				'text-black'
			),
			glass: cx(
				'focus-visible:ring-offset-white',
				'dark:focus-visible:ring-offset-black',
				// 'text-base',
				'shadow-sm',
				'dark:shadow-black/10',
				'border-white/20',
				'hover:border-white/30',
				'focus:border-white/30',
				'text-vercel-accents-5',
				'bg-white/25',
				'hover:bg-white/5',
				'backdrop-blur-sm'
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
				'dark:bg-transparent bg-black dark:border-transparent dark:text-white ',
				// colors | secondary | hover
				'dark:hover:bg-vercel-accents-1',
				// colors | secondary | focus
				'dark:focus-visible:bg-vercel-accents-1 dark:focus-visible:ring ',
				// colors | secondary | active
				'dark:active:bg-vercel-accents-2'
			),
		},
		size: {
			'x-small': 'rounded-full h-6 text-xs leading-0 py-1.5 px-2.5',
			small: 'rounded-full h-8 text-sm leading-0 py-1.5 px-3',
			medium: 'rounded-md  h-10 text-sm leading-0 py-2 px-4 ',
		},
	},
	compoundVariants: [
		{ intent: 'common', size: 'x-small', class: 'font-medium' },
		{ intent: 'primary', size: 'medium', class: 'min-w-[70px]' },
	],
	defaultVariants: {
		intent: 'primary',
		size: 'medium',
	},
})

interface ButtonProps extends ButtonHTMLAttributes, VariantProps<typeof button> {}
//        ^?
// type ButtonProps = VariantProps<typeof button>
// intent: ButtonProps['intent']
// size: ButtonProps['size']

// defineProps<ButtonProps>()
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
