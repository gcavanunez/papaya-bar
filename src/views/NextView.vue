<script setup lang="ts">
import { useChromeTabs } from '@/hooks/useChromeTabs'
import TabManager from '@/components/TabManager.vue'
import { useSessionsData } from '@/hooks/useSessionsData'
import { closeDuplicates } from '@/helpers'
const { windowsMap, loadedGroups, loadedTabHistory, lookUpTab, loadedTabs } = useChromeTabs()
const { storeSession } = useSessionsData()
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
					class="px-3 text-sm font-medium text-slate-500 dark:text-white"
					id="quick-actions-headline"
				>
					Quick Actions
				</p>
				<div class="mt-3 space-y-2" aria-labelledby="quick-actions-headline">
					<button
						class="group flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-papaya-900 dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-2 dark:hover:text-white"
						@click="storeSession(loadedTabs)"
					>
						<span class="truncate"> Save session </span>
					</button>
					<button
						class="group flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-papaya-900 dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-2 dark:hover:text-white"
						@click="closeDuplicates(loadedTabs)"
					>
						<span class="truncate"> Close duplicates </span>
					</button>
					<!-- <a
              v-for="community in communities"
              :key="community.name"
              :href="community.href"
              class="group flex items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              <span class="truncate">
                {{ community.name }}
              </span>
            </a> -->
				</div>
			</div>
		</template>
	</TabManager>
</template>
