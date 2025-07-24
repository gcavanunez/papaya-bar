<script setup lang="ts">
import { Switch, SwitchDescription, SwitchGroup, SwitchLabel } from '@headlessui/vue'
import { ref } from 'vue'

const availableToHire = ref(true)
</script>
<template>
	<div class="relative">
		<div class="container mx-auto max-w-5xl px-4 py-6 sm:px-2">
			<div
				class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:border dark:border-vercel-accents-2 md:rounded-lg"
			>
				<div class="bg-white px-4 py-5 dark:bg-black sm:p-6">
					<div>
						<h2 class="text-lg font-medium leading-6 text-slate-950 dark:text-white">
							Settings
						</h2>
						<p class="mt-1 text-sm text-gray-500 dark:text-white">
							Configure how certain global interactions work.
						</p>
					</div>
					<ul role="list" class="mt-2 divide-y divide-gray-200">
						<SwitchGroup as="li" class="flex items-center justify-between py-4">
							<div class="flex flex-col">
								<SwitchLabel
									as="p"
									class="text-sm font-medium leading-6 text-gray-900 dark:text-white"
									passive
								>
									Copy to links in markdown format
								</SwitchLabel>
								<SwitchDescription class="text-sm text-gray-500 dark:text-white">
									When copying a link it will format them in `[Title](url)`
									format.
								</SwitchDescription>
							</div>
							<Switch
								v-model="availableToHire"
								:class="[
									availableToHire ? 'bg-papaya-900' : 'bg-gray-200',
									'relative ml-4 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2',
								]"
							>
								<span
									aria-hidden="true"
									:class="[
										availableToHire ? 'translate-x-5' : 'translate-x-0',
										'inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
									]"
								/>
							</Switch>
						</SwitchGroup>
					</ul>
				</div>
			</div>
		</div>
	</div>
</template>
