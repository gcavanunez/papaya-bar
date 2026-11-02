<script setup lang="ts">
type InputTypes = 'text' | 'date' | 'time' | 'number' | 'email' | 'tel' | 'password'

defineOptions({ inheritAttrs: false })

withDefaults(
	defineProps<{
		id?: string
		placeholder?: string
		type?: InputTypes
		label?: string
	}>(),
	{
		id: '',
		type: 'text',
		label: '',
		placeholder: '',
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
		<input
			:id="id"
			v-bind="$attrs"
			v-model="model"
			:type="type"
			:placeholder="placeholder"
			class="field h-9"
		/>
	</div>
</template>
