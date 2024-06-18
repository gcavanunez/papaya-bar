<script setup lang="ts">
import AppModal from './AppModal.vue'
import { computed } from 'vue'
interface Props {
	modelValue: boolean
}
const props = defineProps<Props>()
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
	<AppModal v-model="value" title="Group Settings">
		<!-- <form @submit.prevent="onGroupFormSummit">
			<div class="mt-8 grid grid-cols-1 gap-6">
				<div>
					<AppInput
						v-model="groupModalForm.title"
						type="text"
						class="dark:bg-black"
						label="Group label"
					/>
				</div>
				<div>
					<div>
						<h2 class="text-sm font-medium text-gray-900 dark:text-white">Color</h2>

						<RadioGroup v-model="groupModalForm.color" class="mt-2">
							<RadioGroupLabel class="sr-only"> Choose a color </RadioGroupLabel>
							<div class="flex flex-wrap items-center gap-3">
								<RadioGroupOption
									as="template"
									v-for="color in groupColors"
									:key="color.hex"
									:value="color.value"
									v-slot="{ active, checked }"
								>
									<div
										:class="[
											color.selectedColor,
											active && checked ? 'ring ring-offset-1' : '',
											!active && checked ? 'ring-2' : '',
											'relative -m-0.5 flex cursor-pointer items-center justify-center rounded-full p-0.5 focus:outline-none',
										]"
									>
										<RadioGroupLabel as="span" class="sr-only">
											{{ color.value }}
										</RadioGroupLabel>
										<span
											aria-hidden="true"
											:class="[
												color.bgColor,
												'h-8 w-8 rounded-full border border-black border-opacity-10',
											]"
										/>
									</div>
								</RadioGroupOption>
							</div>
						</RadioGroup>
					</div>
				</div>
				<div class="flex justify-end">
					<AppButton intent="primary" size="medium" type="submit">Save</AppButton>
				</div>
			</div>
		</form> -->
	</AppModal>
</template>
