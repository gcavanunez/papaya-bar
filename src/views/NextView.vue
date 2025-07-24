<script setup lang="ts">
import { useChromeTabs } from '@/hooks/useChromeTabs'
import TabManager from '@/components/TabManager.vue'
import { useSessionsData } from '@/hooks/useSessionsData'
import { closeDuplicates, closeTab } from '@/helpers'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import { toast } from 'vue-sonner'

const { windowsMap, loadedGroups, loadedTabHistory, lookUpTab, loadedTabs } = useChromeTabs()
const { storeSession } = useSessionsData()
const { triggerConfirm } = useGlobalConfirm()
const actions = [
	{
		onClick: () => {
			storeSession(loadedTabs.value)
			toast('Session saved')
		},
		text: 'Save session',
	},
	{
		onClick: () => {
			closeDuplicates(loadedTabs.value)

			toast('Session saved and fresh plate')
		},
		text: 'Save and new',
	},
	{
		onClick: () => {
			closeDuplicates(loadedTabs.value)

			toast('Closed duplicates')
		},
		text: 'Close duplicates',
	},
]
</script>

<template>
	<TabManager
		:loaded-tabs="loadedTabs"
		:loaded-groups="loadedGroups"
		:loaded-tab-history="loadedTabHistory"
		:look-up-tab="lookUpTab"
		:windows-map="windowsMap"
	>
		<template #left-section>
			<div class="pt-10">
				<p
					id="quick-actions-headline"
					class="px-3 text-sm font-medium text-slate-500 dark:text-white"
				>
					Quick Actions
				</p>
				<div class="mt-3 space-y-2" aria-labelledby="quick-actions-headline">
					<button
						v-for="action in actions"
						:key="action.text"
						class="group focus-visible:ring-papaya-900 dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-2 flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 dark:hover:text-white"
						@click="action.onClick"
					>
						<span class="truncate"> {{ action.text }} </span>
					</button>
					<button
						class="group focus-visible:ring-papaya-900 dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-2 flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 dark:hover:text-white"
						@click="triggerConfirm(() => closeTab(loadedTabs))"
					>
						<span class="truncate"> Close all</span>
					</button>
				</div>
			</div>
		</template>
	</TabManager>
</template>
