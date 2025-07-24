<script setup lang="ts">
import { computed } from 'vue'
type InputTypes = 'text' | 'date' | 'time' | 'number' | 'email' | 'tel'

interface Props {
	modelValue: string | number
	id?: string
	placeholder?: string
	type?: InputTypes
	label?: string
}
const props = withDefaults(defineProps<Props>(), {
	id: '',
	type: 'text',
	label: '',
	placeholder: ' ',
})
const emit = defineEmits(['update:modelValue'])

const value = computed({
	get() {
		return props.modelValue
	},
	set(value) {
		emit('update:modelValue', value)
	},
})
</script>

<template>
	<div class="relative rounded-md bg-white shadow-sm dark:bg-black">
		<input
			:id="id"
			v-bind="$attrs"
			v-model="value"
			:type="type"
			class="peer w-full rounded-md border border-gray-300 bg-transparent px-3 pb-1 pt-5.5 text-gray-900 placeholder-transparent ring-1 ring-black ring-opacity-5 transition focus:border-gray-600 focus:outline-none focus:ring-0 dark:border-vercel-accents-2 dark:bg-black dark:text-white dark:focus:border-white sm:text-sm"
			:placeholder="placeholder"
		/>
		<label
			v-if="label"
			:for="id"
			class="pointer-events-none absolute left-0 top-1.5 cursor-text px-3 text-xs text-gray-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-500 peer-focus:top-1.5 peer-focus:text-xs peer-focus:text-gray-600 dark:text-gray-300 dark:peer-placeholder-shown:text-gray-50 dark:peer-focus:text-gray-300"
		>
			{{ label }}
		</label>
	</div>
</template>

<!-- <script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  inheritAttrs: false,

  props: {
    id: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    type: {
      type: String,
      default: 'text',
      validador(v: string) {
        return ['text', 'date', 'time', 'number', 'email'].includes(v)
      },
    },
    label: { type: String, default: '' },
    modelValue: { type: [String, Number], default: '' },
  },

  emits: ['update:modelValue'],

  setup() {},
})
</script> -->

<style></style>
