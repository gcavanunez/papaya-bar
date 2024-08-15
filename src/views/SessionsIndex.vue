<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import { formatDistance } from 'date-fns'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useSessionsData } from '@/hooks/useSessionsData'
import { computed, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/forms/AppInput.vue'
const { loadedTabs } = useChromeTabs()
const { state, storeSession, openAll, removeSavedSession, downloadSavedSession } = useSessionsData()

const search = ref('')
const parsedState = computed(() => {
	return [...state.value.entries()]
		.map(([key, value]) => {
			const matches = value.tabs.filter((row) => {
				if (!row.title || !row.url) {
					return false
				}

				return (
					row.title.toLocaleLowerCase().indexOf(search.value.toLocaleLowerCase()) > -1 ||
					row.url.toLocaleLowerCase().indexOf(search.value.toLocaleLowerCase()) > -1
				)
			})
			return {
				key,
				matches,
				humanDistance: formatDistance(new Date(key), new Date()),
				...value,
			}
		})
		.toSorted((a, b) => new Date(b.key).getTime() - new Date(a.key).getTime())
})
// const matchse
</script>
<template>
	<div class="relative">
		<div class="container mx-auto max-w-7xl px-4 py-6 sm:px-2">
			<!-- This example requires Tailwind CSS v2.0+ -->
			<div class="px-4 sm:px-6 lg:px-8">
				<div class="sm:flex sm:items-center">
					<div class="sm:flex-auto">
						<h1 class="text-xl font-semibold text-slate-900 dark:text-white">
							Sessions
						</h1>
						<p class="mt-2 text-sm text-slate-700 dark:text-vercel-accents-5">
							A list of all saved sessions
						</p>
					</div>
					<div class="mt-4 space-x-2 sm:ml-16 sm:mt-0 sm:flex-none">
						<AppButton intent="common" size="x-small" @click="storeSession(loadedTabs)"
							>Restore from file</AppButton
						>
						<AppButton intent="common" size="x-small" @click="storeSession(loadedTabs)"
							>Save session</AppButton
						>
					</div>
				</div>
				<div class="mt-6 flex">
					<div class="lg:w-96">
						<AppInput v-model="search" label="Search" />
					</div>
				</div>
				<div class="mt-8 flex flex-col">
					<div class="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
						<div class="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
							<div
								class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:border dark:border-vercel-accents-2 md:rounded-lg"
							>
								<table
									class="min-w-full divide-y divide-slate-300 dark:divide-vercel-accents-2"
								>
									<thead class="bg-slate-50 dark:bg-black">
										<tr>
											<th
												scope="col"
												class="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 dark:text-vercel-accents-6 sm:pl-6"
											>
												Date
											</th>
											<th
												scope="col"
												class="px-3 py-3.5 text-left text-sm font-semibold text-slate-900 dark:text-vercel-accents-6"
											>
												Tab count
											</th>
											<th
												scope="col"
												class="px-3 py-3.5 text-left text-sm font-semibold text-slate-900 dark:text-vercel-accents-6"
											>
												Description
											</th>
											<th
												scope="col"
												class="relative py-3.5 pl-3 pr-4 sm:pr-6"
											>
												<span class="sr-only">Actions</span>
											</th>
										</tr>
									</thead>
									<tbody
										class="divide-y divide-slate-200 bg-white dark:divide-vercel-accents-2 dark:bg-black"
									>
										<tr
											v-for="value in parsedState"
											:key="value.key"
											:class="{
												'bg-vercel-accents-2':
													value.matches.length && search,
											}"
										>
											<td
												class="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6"
											>
												<div class="flex items-center">
													<div class="">
														<router-link
															:to="{
																name: 'sessions.show',
																params: {
																	uid: value.key,
																},
															}"
														>
															<div
																class="font-medium text-slate-900 dark:text-white"
															>
																{{ value.key }}
															</div>
														</router-link>
														<div
															class="text-slate-500 dark:text-vercel-accents-4"
														>
															{{ value.humanDistance }}
														</div>
													</div>
												</div>
											</td>
											<td
												class="whitespace-nowrap px-3 py-4 text-sm text-slate-500 dark:text-vercel-accents-4"
											>
												<div class="text-slate-900 dark:text-white">
													{{ value.tabs.length }}
												</div>
											</td>

											<td
												class="whitespace-nowrap px-3 py-4 text-sm text-slate-500 dark:text-vercel-accents-4"
											>
												<span
													v-if="value.title"
													class="text-wrap font-medium text-slate-900 dark:text-white"
												>
													{{ value.title }}
												</span>
												<span v-else class="italic"
													>without description</span
												>
											</td>
											<td
												class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6"
											>
												<div class="space-x-2">
													<AppBtn @click="openAll(value)"
														>Open session</AppBtn
													>
													<AppBtn @click="removeSavedSession(value.key)"
														>Remove session</AppBtn
													>
													<AppBtn
														@click="
															downloadSavedSession(value.key, value)
														"
														>Download session</AppBtn
													>
												</div>
											</td>
										</tr>
									</tbody>
								</table>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
