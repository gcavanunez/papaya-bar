<script setup lang="ts">
import { ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'

const props = defineProps<{
	modelValue: boolean
	title: string
}>()
const emit = defineEmits<{
	(event: 'update:modelValue', payload: boolean): void
}>()

// const isOpen = props.modelValue

function closeModal() {
	emit('update:modelValue', false)
}
function openModal() {
	emit('update:modelValue', false)
}
</script>

<template>
	<TransitionRoot appear :show="modelValue" as="template">
		<Dialog as="div" @close="closeModal" class="relative z-50">
			<TransitionChild
				as="template"
				enter="duration-300 ease-out"
				enter-from="opacity-0"
				enter-to="opacity-100"
				leave="duration-200 ease-in"
				leave-from="opacity-100"
				leave-to="opacity-0"
			>
				<div
					class="fixed inset-0 bg-gray-500 bg-opacity-75 opacity-100 backdrop-blur backdrop-filter transition-opacity"
				/>
			</TransitionChild>

			<div class="fixed inset-0 overflow-y-auto">
				<div class="flex min-h-full items-center justify-center p-4 text-center">
					<TransitionChild
						as="template"
						enter="duration-300 ease-out"
						enter-from="opacity-0 scale-95"
						enter-to="opacity-100 scale-100"
						leave="duration-200 ease-in"
						leave-from="opacity-100 scale-100"
						leave-to="opacity-0 scale-95"
					>
						<DialogPanel
							class="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all dark:bg-black lg:max-w-lg"
						>
							<DialogTitle
								as="h3"
								class="text-lg font-medium leading-6 text-gray-900 dark:text-white"
							>
								{{ title }}
							</DialogTitle>
							<slot></slot>
						</DialogPanel>
					</TransitionChild>
				</div>
			</div>
		</Dialog>
	</TransitionRoot>
</template>
