<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import { formatDistance } from 'date-fns'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useSessionsData } from '@/hooks/useSessionsData'
import { computed, onMounted, reactive, ref } from 'vue'
import TabManager from '@/components/TabManager.vue'
import { Group, HistoryMap, LookUpTab, SaveableTab, Tab, WindowsMap } from '@/types'
import { getTabHistory } from '@/helpers'
import { useChromeWindowsMap } from '@/hooks/useChromeWindowsMap'
import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import AppInput from '@/components/forms/AppInput.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'

const { findByUid, saveByUid } = useSessionsData()
type Props = {
	uid: string
}
const { uid } = defineProps<Props>()
const parsedState = findByUid(uid)!

const loadedTabsState = ref(parsedState.tabs)
const loadedGroups = ref(parsedState.groups)
const loadedTabHistory = ref<HistoryMap>(new Map())
const lookUpTab = ref<LookUpTab>({})
const windowsMap = useChromeWindowsMap({ loadedTabs: loadedTabsState })

const data = reactive({
	title: '',
	description: '',
})
onMounted(async () => {
	const { loadedTabHistory: loadedTabHistoryValues, lookUpTab: lookUpTabValues } =
		await getTabHistory(parsedState.tabs)
	loadedTabHistory.value = loadedTabHistoryValues
	lookUpTab.value = lookUpTabValues
	data.description = parsedState.description
	data.title = parsedState.title
})
const openEdit = ref(false)
const toggleEdit = () => {
	openEdit.value = true
}
const updateSession = () => {
	console.log({ data })
	saveByUid(uid, { title: data.title, description: data.description })
	openEdit.value = false
}
</script>
<template>
	<div class="flex flex-1 flex-col">
		<div class="container mx-auto py-6 px-4 sm:px-2 lg:max-w-7xl">
			<!-- This example requires Tailwind CSS v2.0+ -->
			<div class="px-4 sm:px-6 lg:px-8" v-if="parsedState">
				<div class="justify-between sm:flex sm:items-center">
					<div class="flex flex-col">
						<h1 class="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
							Tabs {{ parsedState.tabs.length }}
						</h1>
						<nav aria-label="Breadcrumbs" class="order-first flex space-x-2 text-sm font-semibold">
							<router-link
								class="text-slate-500 hover:text-slate-600 dark:text-vercel-accents-5 dark:hover:text-white"
								:to="{ name: 'sessions' }"
							>
								Sessions
							</router-link>
							<div aria-hidden="true" class="select-none text-slate-400">/</div>
							<a
								class="text-slate-500 hover:text-slate-600 dark:text-vercel-accents-5 dark:hover:text-white"
								href="#"
							>
								{{ uid }}
							</a>
						</nav>
					</div>
					<div class="mt-4 space-x-2 sm:mt-0 sm:ml-16 sm:flex-none">
						<AppButton intent="primary" size="medium" @click="toggleEdit">Edit</AppButton>
						<AppModal v-model="openEdit" title="Edit Session">
							<form @submit.prevent="updateSession">
								<div class="mt-8 grid grid-cols-1 gap-6">
									<div>
										<AppInput
											v-model="data.title"
											type="text"
											id="sesh-title"
											class="dark:bg-black"
											label="Group label"
										/>
									</div>
									<div>
										<!-- <input v-model="groupModalForm.color" class="dark:bg-black" /> -->

										<AppTextarea
											v-model="data.description"
											label="Description"
											id="sesh-description"
											name="sup"
										/>
									</div>
									<div class="flex justify-end">
										<AppButton intent="primary" size="medium" type="submit">Save</AppButton>
									</div>
								</div>
							</form>
						</AppModal>
					</div>
				</div>
			</div>
		</div>
		<TabManager
			:loaded-tabs="loadedTabsState"
			:loaded-groups="loadedGroups"
			:loaded-tab-history="loadedTabHistory"
			:look-up-tab="lookUpTab"
			:windows-map="windowsMap"
		/>
	</div>
</template>
