<script setup lang="ts">
import { computed } from 'vue'
import { Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/20/solid'
import { prettyKeys, type KeyBinding } from '@/hooks/useKeymap'

const props = defineProps<{
	open: boolean
	bindings: KeyBinding[]
}>()

const emit = defineEmits<{
	(e: 'close'): void
}>()

const sections = computed(() => {
	const map = new Map<string, KeyBinding[]>()
	for (const binding of props.bindings) {
		if (binding.hidden) continue
		const list = map.get(binding.group) ?? []
		list.push(binding)
		map.set(binding.group, list)
	}
	return [...map.entries()]
})
</script>

<template>
	<TransitionRoot :show="open" as="template" appear>
		<Dialog class="relative z-50" @close="emit('close')">
			<TransitionChild
				as="template"
				enter="ease-out duration-200"
				enter-from="opacity-0"
				enter-to="opacity-100"
				leave="ease-in duration-150"
				leave-from="opacity-100"
				leave-to="opacity-0"
			>
				<div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/70" />
			</TransitionChild>

			<div class="fixed inset-0 overflow-y-auto p-4 sm:p-6 md:p-16">
				<TransitionChild
					as="template"
					enter="ease-out duration-200"
					enter-from="opacity-0 scale-95"
					enter-to="opacity-100 scale-100"
					leave="ease-in duration-150"
					leave-from="opacity-100 scale-100"
					leave-to="opacity-0 scale-95"
				>
					<DialogPanel
						class="dark:border-vercel-accents-2 mx-auto max-w-3xl transform rounded-xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:bg-black"
					>
						<div class="flex items-center justify-between">
							<DialogTitle
								class="text-base font-semibold text-slate-900 dark:text-white"
							>
								Keyboard shortcuts
							</DialogTitle>
							<button
								type="button"
								class="dark:hover:bg-vercel-accents-2 flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:text-white"
								@click="emit('close')"
							>
								<span class="sr-only">Close shortcuts help</span>
								<XMarkIcon class="size-4" aria-hidden="true" />
							</button>
						</div>

						<div class="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
							<div v-for="[group, groupBindings] in sections" :key="group">
								<h3 class="section-label mb-2">
									{{ group }}
								</h3>
								<div class="space-y-1.5">
									<div
										v-for="binding in groupBindings"
										:key="binding.id"
										class="flex items-center justify-between gap-4"
									>
										<span
											class="dark:text-vercel-accents-6 text-sm text-slate-700"
										>
											{{ binding.description }}
										</span>
										<span class="flex shrink-0 items-center gap-1">
											<kbd
												v-for="(chip, chipIndex) in prettyKeys(
													binding.keys,
												)"
												:key="chipIndex"
												class="kbd px-1.5"
											>
												{{ chip }}
											</kbd>
										</span>
									</div>
								</div>
							</div>
						</div>

						<p class="dark:text-vercel-accents-4 mt-6 text-xs text-slate-500">
							Counts work like vim: prefix any motion or action with a number —
							<span class="font-mono">3j</span> moves down three,
							<span class="font-mono">3dd</span> closes three rows from the cursor.
						</p>
						<p
							v-if="$slots.footer"
							class="dark:text-vercel-accents-4 mt-2 text-xs leading-6 text-slate-500"
						>
							<slot name="footer" />
						</p>
					</DialogPanel>
				</TransitionChild>
			</div>
		</Dialog>
	</TransitionRoot>
</template>
