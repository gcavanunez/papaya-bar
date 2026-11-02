<script setup lang="ts">
import { ref } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/20/solid'

defineOptions({ inheritAttrs: false })

withDefaults(
	defineProps<{
		placeholder?: string
		size?: 'sm' | 'md'
	}>(),
	{
		placeholder: 'Search…',
		size: 'md',
	},
)

const model = defineModel<string>({ required: true })
const input = ref<HTMLInputElement | null>(null)

const clear = () => {
	model.value = ''
	input.value?.focus()
}

defineExpose({
	input,
	focus: () => input.value?.focus(),
})
</script>

<template>
	<div
		:class="[
			'dark:border-vercel-accents-2 flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white shadow-xs transition-colors focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 dark:bg-black dark:focus-within:border-blue-400 dark:focus-within:ring-blue-400',
			size === 'sm' ? 'h-8 px-2.5' : 'h-9 px-3',
		]"
	>
		<MagnifyingGlassIcon
			class="dark:text-vercel-accents-4 size-4 shrink-0 text-slate-400"
			aria-hidden="true"
		/>
		<input
			ref="input"
			v-model="model"
			v-bind="$attrs"
			type="text"
			autocomplete="off"
			spellcheck="false"
			:placeholder="placeholder"
			class="dark:placeholder:text-vercel-accents-4 h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none dark:text-white"
		/>
		<slot name="trailing" />
		<button
			v-if="model"
			type="button"
			class="dark:hover:bg-vercel-accents-2 -mr-1 flex size-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:text-white"
			@click="clear"
		>
			<span class="sr-only">Clear search</span>
			<XMarkIcon class="size-4" aria-hidden="true" />
		</button>
	</div>
</template>
