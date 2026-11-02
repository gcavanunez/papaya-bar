<script setup lang="ts">
import { Switch } from '@headlessui/vue'

withDefaults(
	defineProps<{
		/** Screen-reader label, used when the switch isn't inside a SwitchGroup */
		label?: string
		size?: 'sm' | 'md'
	}>(),
	{
		label: '',
		size: 'md',
	},
)

const model = defineModel<boolean>({ required: true })
</script>

<template>
	<Switch
		v-model="model"
		:class="[
			model ? 'bg-blue-600 dark:bg-blue-500' : 'dark:bg-vercel-accents-3 bg-slate-200',
			size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
			'relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
			'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
		]"
	>
		<span v-if="label" class="sr-only">{{ label }}</span>
		<span
			aria-hidden="true"
			:class="[
				size === 'sm' ? 'size-4' : 'size-5',
				model ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0',
				'pointer-events-none inline-block rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out',
			]"
		/>
	</Switch>
</template>
