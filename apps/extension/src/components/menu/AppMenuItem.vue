<script setup lang="ts">
import { computed, type Component } from 'vue'
import { MenuItem } from '@headlessui/vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

const props = withDefaults(
	defineProps<{
		icon?: Component
		danger?: boolean
		disabled?: boolean
		to?: RouteLocationRaw
		href?: string
	}>(),
	{
		danger: false,
		disabled: false,
	},
)

const emit = defineEmits<{
	(e: 'click', event: MouseEvent): void
}>()

const tag = computed(() => (props.to ? RouterLink : props.href ? 'a' : 'button'))
const tagAttrs = computed(() => {
	if (props.to) return { to: props.to }
	if (props.href) return { href: props.href, target: '_blank', rel: 'noreferrer' }
	return { type: 'button' }
})
</script>

<template>
	<MenuItem v-slot="{ active }" :disabled="disabled">
		<component
			:is="tag"
			v-bind="tagAttrs"
			:class="[
				'menu-item',
				disabled ? 'cursor-not-allowed opacity-40' : '',
				danger
					? active
						? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
						: 'text-red-600 dark:text-red-400'
					: active
						? 'dark:bg-vercel-accents-2 bg-slate-100 text-slate-900 dark:text-white'
						: '',
			]"
			@click="emit('click', $event)"
		>
			<slot name="leading">
				<component
					:is="icon"
					v-if="icon"
					:class="[
						'size-4 shrink-0',
						danger
							? 'text-red-500 dark:text-red-400'
							: 'dark:text-vercel-accents-5 text-slate-400',
					]"
					aria-hidden="true"
				/>
			</slot>
			<span class="min-w-0 flex-1 truncate"><slot /></span>
			<slot name="trailing" />
		</component>
	</MenuItem>
</template>
