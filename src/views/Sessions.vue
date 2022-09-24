<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import { formatDistance } from 'date-fns'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useSessionsData } from '@/hooks/useSessionsData'
import { computed } from 'vue'
const { loadedTabs } = useChromeTabs()
const { state, storeSession, openAll, removeSavedSession, downloadSavedSession } = useSessionsData()

const parsedState = computed(() => {
	return [...state.value.entries()].map(([key, value]) => {
		return {
			key,
			humanDistance: formatDistance(new Date(key), new Date()),
			...value,
		}
	})
})
</script>
<template>
	<div class="relative bg-slate-100">
		<div class="container mx-auto max-w-7xl py-6 px-4 sm:px-2">
			<!-- This example requires Tailwind CSS v2.0+ -->
			<div class="px-4 sm:px-6 lg:px-8">
				<div class="sm:flex sm:items-center">
					<div class="sm:flex-auto">
						<h1 class="text-xl font-semibold text-slate-900">Sessions</h1>
						<p class="mt-2 text-sm text-slate-700">A list of all saved sessions</p>
					</div>
					<div class="mt-4 space-x-2 sm:mt-0 sm:ml-16 sm:flex-none">
						<AppBtn color="white" @click="storeSession(loadedTabs)">Restore from file</AppBtn>
						<AppBtn color="white" @click="storeSession(loadedTabs)">Save session</AppBtn>
					</div>
				</div>
				<div class="mt-8 flex flex-col">
					<div class="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
						<div class="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
							<div class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
								<table class="min-w-full divide-y divide-slate-300">
									<thead class="bg-slate-50">
										<tr>
											<th
												scope="col"
												class="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 sm:pl-6"
											>
												Date
											</th>
											<th
												scope="col"
												class="px-3 py-3.5 text-left text-sm font-semibold text-slate-900"
											>
												Tab count
											</th>
											<th
												scope="col"
												class="px-3 py-3.5 text-left text-sm font-semibold text-slate-900"
											>
												Description
											</th>
											<th scope="col" class="relative py-3.5 pl-3 pr-4 sm:pr-6">
												<span class="sr-only">Actions</span>
											</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-200 bg-white">
										<tr v-for="value in parsedState" :key="value.key">
											<td class="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
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
															<div class="font-medium text-slate-900">{{ value.key }}</div>
														</router-link>
														<div class="text-slate-500">{{ value.humanDistance }}</div>
													</div>
												</div>
											</td>
											<td class="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
												<div class="text-slate-900">{{ value.tabs.length }}</div>
											</td>

											<td class="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
												<span v-if="value.title">{{ value.title }}</span>
												<span class="italic">without description</span>
											</td>
											<td
												class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6"
											>
												<div class="space-x-2">
													<AppBtn @click="openAll(value)">Open session</AppBtn>
													<AppBtn @click="removeSavedSession(value.key)">Remove session</AppBtn>
													<AppBtn @click="downloadSavedSession(value.key, value)"
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
