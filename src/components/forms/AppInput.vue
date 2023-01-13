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
const { id = '', type = '', label = '', placeholder = ' ', modelValue } = defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const value = computed({
	get() {
		return modelValue
	},
	set(value) {
		emit('update:modelValue', value)
	},
})
</script>

<template>
	<div class="relative rounded-sm shadow-sm dark:bg-black">
		<input
			:id="id"
			v-bind="$attrs"
			v-model="value"
			:type="type"
			class="focus:border-gatopolis-light peer w-full rounded-md border border-gray-300 bg-transparent px-3 pb-0.5 pt-[1.375rem] text-gray-900 placeholder-transparent focus:outline-none focus:ring-0 dark:bg-black dark:text-white sm:text-sm"
			:placeholder="placeholder"
		/>
		<label
			v-if="label"
			:for="id"
			class="pointer-events-none absolute top-1.5 left-0 cursor-text px-3 text-xs text-gray-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-500 peer-focus:top-1.5 peer-focus:text-xs peer-focus:text-gray-600 dark:text-gray-300 dark:peer-placeholder-shown:text-gray-50 dark:peer-focus:text-gray-300"
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
