<script setup lang="ts" generic="T extends string | number">
import type { Component } from 'vue'
import { RadioGroup, RadioGroupLabel, RadioGroupOption } from '@headlessui/vue'

withDefaults(
	defineProps<{
		options: { value: T; label: string; icon?: Component; title?: string }[]
		/** Accessible name for the group */
		label: string
		size?: 'sm' | 'md'
		/** Show icons only; labels become tooltips + screen-reader text */
		iconOnly?: boolean
		/** Stretch to fill the container with equal-width segments */
		block?: boolean
	}>(),
	{
		size: 'md',
		iconOnly: false,
		block: false,
	},
)

const model = defineModel<T>({ required: true })
</script>

<template>
	<RadioGroup
		v-model="model"
		:class="[
			'dark:bg-vercel-accents-2 items-center gap-0.5 rounded-md bg-slate-100 p-0.5',
			block ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex',
			size === 'sm' ? 'h-7' : 'h-8',
		]"
	>
		<RadioGroupLabel class="sr-only">{{ label }}</RadioGroupLabel>
		<RadioGroupOption
			v-for="option in options"
			:key="option.value"
			v-slot="{ checked }"
			as="template"
			:value="option.value"
		>
			<button
				type="button"
				:title="option.title ?? (iconOnly ? option.label : undefined)"
				:class="[
					'flex h-full items-center justify-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors',
					'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500',
					size === 'sm' ? 'text-xs' : 'text-sm',
					iconOnly ? 'aspect-square' : size === 'sm' ? 'px-2' : 'px-2.5',
					checked
						? 'dark:bg-vercel-accents-3 bg-white text-slate-900 shadow-xs dark:text-white'
						: 'dark:text-vercel-accents-5 text-slate-500 hover:text-slate-900 dark:hover:text-white',
				]"
			>
				<component :is="option.icon" v-if="option.icon" class="size-4 shrink-0" />
				<span :class="iconOnly ? 'sr-only' : ''">{{ option.label }}</span>
			</button>
		</RadioGroupOption>
	</RadioGroup>
</template>
