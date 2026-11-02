<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(
	defineProps<{
		id?: string
		label?: string
		placeholder?: string
		/** Grow with content instead of scrolling */
		autogrow?: boolean
	}>(),
	{
		id: '',
		label: '',
		placeholder: '',
		autogrow: true,
	},
)

const model = defineModel<string | number>({ required: true })
</script>

<template>
	<div>
		<label
			v-if="label"
			:for="id"
			class="dark:text-vercel-accents-7 mb-1.5 block text-sm font-medium text-slate-700"
		>
			{{ label }}
		</label>
		<textarea
			v-if="autogrow"
			:id="id"
			v-bind="$attrs"
			v-model="model"
			v-autogrow
			:placeholder="placeholder"
			class="field py-2"
		/>
		<textarea
			v-else
			:id="id"
			v-bind="$attrs"
			v-model="model"
			:placeholder="placeholder"
			class="field py-2"
		/>
	</div>
</template>
