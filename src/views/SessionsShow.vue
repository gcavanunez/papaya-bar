<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import { formatDistance } from 'date-fns'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useSessionsData } from '@/hooks/useSessionsData'
import { computed, onMounted, ref } from 'vue'
import TabManager from '@/components/TabManager.vue'
import { Group, HistoryMap, LookUpTab, SaveableTab, Tab, WindowsMap } from '@/types'
const { loadedTabs } = useChromeTabs()
const { findByUid } = useSessionsData()
type Props = {
	uid: string
}
const { uid } = defineProps<Props>()
const parsedState = findByUid(uid)!

const loadedTabsState = ref(parsedState.tabs)
const loadedGroups = ref(parsedState.groups)
const loadedTabHistory = ref<HistoryMap>(new Map())
const lookUpTab = ref<LookUpTab>({})
const windowsMap = computed<WindowsMap>(() => {
	const windowsSet = new Map<number, string>()
	return windowsSet
})

onMounted(() => {
	// 	const loadedTabsState = parsedState.tabs
})
</script>
<template>
	<div class="">
		<div class="container mx-auto py-6 px-4 sm:px-2 lg:max-w-7xl">
			<!-- This example requires Tailwind CSS v2.0+ -->
			<div class="px-4 sm:px-6 lg:px-8" v-if="parsedState">
				<div class="sm:flex sm:items-center">
					<div class="flex flex-col">
						<h1 class="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
							Tabs {{ parsedState.tabs.length }}
						</h1>
						<nav aria-label="Breadcrumbs" class="order-first flex space-x-2 text-sm font-semibold">
							<router-link class="text-slate-500 hover:text-slate-600" :to="{ name: 'sessions' }">
								Sessions
							</router-link>
							<div aria-hidden="true" class="select-none text-slate-400">/</div>
							<a class="text-slate-500 hover:text-slate-600" href="#">
								{{ uid }}
							</a>
						</nav>
					</div>
					<div class="mt-4 space-x-2 sm:mt-0 sm:ml-16 sm:flex-none"></div>
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
