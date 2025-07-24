<script setup lang="ts">
import { computed, type TextareaHTMLAttributes } from 'vue'

/* @vue-ignore */
interface Props extends /* @vue-ignore */ TextareaHTMLAttributes {
	modelValue: string | number
	label?: string
	placeholder?: string
}
const props = withDefaults(defineProps<Props>(), {
	id: '',
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
	<div class="relative rounded-sm shadow-sm dark:bg-black">
		<!-- <ResizeAuto>
			<template v-slot:default="{ resize }"> -->
		<!-- @input="resize" -->
		<textarea
			:id="id"
			v-bind="$attrs"
			v-model="value"
			v-autogrow
			class="focus:border-gatopolis-light peer w-full rounded-md border border-gray-300 bg-transparent px-3 pb-0.5 pt-5.5 text-gray-900 placeholder-transparent focus:outline-none focus:ring-0 dark:bg-black dark:text-white sm:text-sm"
			:placeholder="placeholder"
		/>
		<label
			v-if="label"
			:for="id"
			class="pointer-events-none absolute left-0 top-1.5 cursor-text px-3 text-xs text-gray-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-500 peer-focus:top-1.5 peer-focus:text-xs peer-focus:text-gray-600 dark:text-gray-300 dark:peer-placeholder-shown:text-gray-50 dark:peer-focus:text-gray-300"
		>
			{{ label }}
		</label>
		<!-- </template>
</ResizeAuto> -->
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
