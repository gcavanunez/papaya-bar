<script setup lang="ts">
import { ref } from 'vue'
import {
	TransitionRoot,
	TransitionChild,
	Dialog,
	DialogPanel,
	DialogTitle,
	DialogDescription,
} from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/20/solid'

const initialFocus = ref<HTMLElement | null>(null)
const setSlotRef = (el: HTMLElement | null) => {
	initialFocus.value = el
}

withDefaults(
	defineProps<{
		modelValue: boolean
		title: string
		description?: string
	}>(),
	{
		description: '',
	},
)

const emit = defineEmits<{
	(event: 'update:modelValue', payload: boolean): void
	(event: 'after-enter'): void
}>()

function closeModal() {
	emit('update:modelValue', false)
}

function afterEnter() {
	emit('after-enter')
}
</script>

<template>
	<TransitionRoot appear :show="modelValue" as="template" @after-enter="afterEnter">
		<Dialog as="div" class="relative z-[60]" :initial-focus="initialFocus" @close="closeModal">
			<TransitionChild
				as="template"
				enter="duration-200 ease-out"
				enter-from="opacity-0"
				enter-to="opacity-100"
				leave="duration-150 ease-in"
				leave-from="opacity-100"
				leave-to="opacity-0"
			>
				<div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/70" />
			</TransitionChild>

			<div class="fixed inset-0 overflow-y-auto">
				<div class="flex min-h-full items-center justify-center p-4">
					<TransitionChild
						as="template"
						enter="duration-200 ease-out"
						enter-from="opacity-0 scale-95"
						enter-to="opacity-100 scale-100"
						leave="duration-150 ease-in"
						leave-from="opacity-100 scale-100"
						leave-to="opacity-0 scale-95"
					>
						<DialogPanel
							class="dark:border-vercel-accents-2 relative w-full max-w-md rounded-xl bg-white p-5 text-left shadow-xl ring-1 ring-black/5 dark:border dark:bg-black dark:ring-0"
						>
							<DialogTitle
								as="h2"
								class="pr-8 text-base font-semibold text-slate-900 dark:text-white"
							>
								{{ title }}
							</DialogTitle>
							<DialogDescription
								v-if="description"
								class="dark:text-vercel-accents-5 mt-1 text-sm text-slate-500"
							>
								{{ description }}
							</DialogDescription>
							<div class="mt-5">
								<slot :trigger="setSlotRef"></slot>
							</div>
							<button
								type="button"
								class="dark:hover:bg-vercel-accents-2 absolute top-4 right-4 flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:text-white"
								@click="closeModal"
							>
								<span class="sr-only">Close</span>
								<XMarkIcon class="size-4" aria-hidden="true" />
							</button>
						</DialogPanel>
					</TransitionChild>
				</div>
			</div>
		</Dialog>
	</TransitionRoot>
</template>
