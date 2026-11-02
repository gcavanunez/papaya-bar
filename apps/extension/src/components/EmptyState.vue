<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
	defineProps<{
		icon?: Component
		title: string
		description?: string
		compact?: boolean
	}>(),
	{
		description: '',
		compact: false,
	},
)
</script>

<template>
	<div
		:class="[
			'flex flex-col items-center justify-center text-center',
			compact ? 'px-4 py-8' : 'px-6 py-16',
		]"
	>
		<div
			v-if="icon"
			class="dark:bg-vercel-accents-2 dark:text-vercel-accents-5 mb-4 flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"
		>
			<component :is="icon" class="size-5" aria-hidden="true" />
		</div>
		<h3 class="text-sm font-semibold text-slate-900 dark:text-white">{{ title }}</h3>
		<p
			v-if="description || $slots.default"
			class="dark:text-vercel-accents-5 mt-1 max-w-sm text-sm text-slate-500"
		>
			<slot>{{ description }}</slot>
		</p>
		<div v-if="$slots.actions" class="mt-5 flex items-center gap-2">
			<slot name="actions" />
		</div>
	</div>
</template>
