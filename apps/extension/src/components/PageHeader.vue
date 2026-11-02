<script setup lang="ts">
withDefaults(
	defineProps<{
		title: string
		description?: string
	}>(),
	{
		description: '',
	},
)
</script>

<template>
	<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
		<div class="min-w-0">
			<div
				v-if="$slots.breadcrumb"
				class="dark:text-vercel-accents-5 mb-1.5 flex items-center gap-1.5 text-sm text-slate-500"
			>
				<slot name="breadcrumb" />
			</div>
			<h1
				class="truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-white"
			>
				{{ title }}
			</h1>
			<p
				v-if="description || $slots.description"
				class="dark:text-vercel-accents-5 mt-1 text-sm text-slate-500"
			>
				<slot name="description">{{ description }}</slot>
			</p>
		</div>
		<div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
			<slot name="actions" />
		</div>
	</div>
</template>
