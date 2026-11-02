<script setup lang="ts">
import { button, type ButtonVariants } from '@/lib/ui'

withDefaults(
	defineProps<{
		intent?: ButtonVariants['intent']
		size?: ButtonVariants['size']
		/** Equal width and height, for icon-only buttons */
		square?: boolean
		type?: 'button' | 'submit' | 'reset'
	}>(),
	{
		intent: 'secondary',
		size: 'md',
		square: false,
		type: 'button',
	},
)
</script>

<template>
	<button :type="type" :class="button({ intent, size, square })">
		<slot />
	</button>
</template>
