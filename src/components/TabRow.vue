<script setup lang="ts">
import { format, formatDistance } from 'date-fns'
import {
	Menu,
	MenuButton,
	MenuItems,
	MenuItem,
	Disclosure,
	DisclosureButton,
	DisclosurePanel,
} from '@headlessui/vue'
import {
	PlusIcon,
	XMarkIcon,
	MinusIcon,
	ChevronUpIcon,
	ChevronDownIcon,
} from '@heroicons/vue/20/solid'
import { closeTab, copyLink, moveTabTo, goTo } from '@/helpers'
import { Tab, HistoryMap, Group } from '@/types'
import { computed, ref } from 'vue'
import { usePopper } from '@/hooks/usePopper'
import AppBtn from './AppBtn.vue'

let [trigger, container] = usePopper({
	placement: 'auto',
	strategy: 'fixed',
	modifiers: [{ name: 'offset', options: { offset: [0, 10] } }],
})

interface Props {
	tab: Tab
	tabsSelected: Set<string>
	windowsMap: Map<number, string>
	loadedGroups: Group[]
	history: HistoryMap
}
const { tab, tabsSelected, windowsMap, history, loadedGroups } = defineProps<Props>()
const emit = defineEmits<{
	(e: 'toggleSelection', tab: Tab): void
}>()
const hasImageError = ref(false)
const onImageLoadError = () => {
	hasImageError.value = true
}
const tabHistory = computed(() => {
	if (!tab.url) {
		return []
	}
	let hasHistory = history.get(tab.url)
	if (!hasHistory) {
		return []
	}
	return [...hasHistory]
		.sort((a, b) => new Date(b.visitTime!).getTime() - new Date(a.visitTime!).getTime())
		.map((row) => ({
			...row,
			humanDistance: formatDistance(new Date(row.visitTime!), new Date()),
			dateTime: format(new Date(row.visitTime!), 'hh:mm aaa MM/dd/yyyy'),
		}))
})
</script>

<template>
	<li class="group w-full py-2" :key="`${tab.windowId}-${tab.stableId}`">
		<Disclosure v-slot="{ open }">
			<div
				class="relative overflow-hidden rounded-lg border-l-4 shadow-sm ring-1 ring-black ring-opacity-5 transition dark:ring-vercel-accents-2"
				:style="{
					borderColor: loadedGroups.find((row) => row.id === tab.groupId)?.color,
				}"
				:class="{
					'group-hover:border-l-slate-200  dark:border-black dark:group-hover:border-vercel-accents-1':
						!loadedGroups.find((row) => row.id === tab.groupId)?.color &&
						!tabsSelected.has(tab.stableId),
					'group-hover:border-papaya-500/85 border-papaya-500':
						!loadedGroups.find((row) => row.id === tab.groupId)?.color &&
						tabsSelected.has(tab.stableId),
				}"
			>
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-between px-2 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
				>
					<div>
						<button
							class="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-slate-100 bg-slate-100 text-slate-800 shadow-md transition dark:bg-white dark:hover:border-white dark:hover:bg-black dark:hover:text-white dark:active:bg-vercel-accents-2 dark:active:text-white"
							@click="emit('toggleSelection', tab)"
						>
							<PlusIcon class="h-4 w-4" v-if="!tabsSelected.has(tab.stableId)" />
							<MinusIcon class="h-4 w-4" v-else />
						</button>
					</div>
					<div class="pointer-events-auto flex items-center space-x-2">
						<Menu as="div" class="pointer-events-auto relative inline-flex text-left">
							<div>
								<MenuButton
									ref="trigger"
									class="pointer-events-auto inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5"
								>
									Move to
									<ChevronDownIcon
										class="ml-2 -mr-1 h-3 w-3 text-slate-800 dark:text-white"
										aria-hidden="true"
									/>
								</MenuButton>
							</div>
							<div ref="container" class="z-20 w-56">
								<transition
									enter-active-class="transition duration-100 ease-out"
									enter-from-class="transform scale-95 opacity-0"
									enter-to-class="transform scale-100 opacity-100"
									leave-active-class="transition duration-75 ease-in"
									leave-from-class="transform scale-100 opacity-100"
									leave-to-class="transform scale-95 opacity-0"
								>
									<!-- origin-top-right -->
									<!-- class="absolute right-0 mt-2 divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none" -->
									<MenuItems
										class="w-full divide-y divide-gray-100 rounded-md border border-gray-200 bg-white shadow-lg outline-none"
									>
										<div class="px-1 py-1">
											<MenuItem
												v-slot="{ active, disabled }"
												:disabled="windowId === tab.windowId"
												:key="`${windowId}-${tab.stableId}`"
												v-for="[windowId, value] in [...windowsMap]"
												@click="
													moveTabTo([tab], { containerId: windowId, type: 'window_container' })
												"
											>
												<button
													:class="[
														active ? 'bg-blue-500 text-white' : 'text-slate-700',
														'group flex w-full items-center rounded-md px-2 py-2 text-sm',
														disabled ? 'opacity-50' : 'opacity-100',
													]"
												>
													{{ value }}
												</button>
											</MenuItem>
										</div>
										<div class="px-1 py-1">
											<MenuItem
												v-slot="{ active, disabled }"
												:key="`${loadedGroup.id}-custom-selected`"
												v-for="loadedGroup in loadedGroups"
												@click="
													moveTabTo([tab], {
														containerId: loadedGroup.id,
														type: 'group_container',
													})
												"
											>
												<button
													:class="[
														active ? 'bg-blue-500 text-white' : 'text-slate-700',
														'group flex w-full items-center rounded-md px-2 py-2 text-sm',
														disabled ? 'opacity-50' : 'opacity-100',
													]"
												>
													{{ loadedGroup.title }}
												</button>
											</MenuItem>
										</div>
									</MenuItems>
								</transition>
							</div>
						</Menu>
						<DisclosureButton as="template">
							<AppBtn :class="{ 'opacity-75': open }">
								History
								<ChevronUpIcon
									:class="open ? 'rotate-180 transform' : ''"
									class="ml-2 -mr-1 h-3 w-3 text-slate-800 transition dark:text-white"
									aria-hidden="true"
								/>
							</AppBtn>
						</DisclosureButton>
						<AppBtn @click="copyLink(tab)"> Copy </AppBtn>
						<AppBtn @click="closeTab(tab)" color="round-primary">
							<XMarkIcon class="h-3 w-3" />
						</AppBtn>
					</div>
				</div>
				<!-- 
          ring-2 ring-inset
          :style="{
						'--tw-ring-color':
							loadedGroups.find((row) => row.id === tab.groupId)?.color || 'transparent',
					}" -->
				<button
					class="flex w-full items-center rounded py-2 px-2"
					:class="
						!tabsSelected.has(tab.stableId)
							? 'bg-white group-hover:bg-slate-200 dark:bg-black dark:group-hover:bg-vercel-accents-1'
							: 'group-hover:bg-papaya-500/85 bg-papaya-500'
					"
					:title="tab.url"
					@click="goTo(tab)"
				>
					<div class="shrink-0">
						<img
							class="h-8 w-8 rounded-full"
							:src="tab.favIconUrl"
							alt=""
							@error="onImageLoadError"
							v-if="!hasImageError && tab.favIconUrl"
						/>
						<div class="h-8 w-8 rounded-full bg-slate-700" v-else></div>
					</div>
					<div
						class="ml-2 truncate text-sm font-medium group-hover:mr-40 group-focus:truncate"
						:class="
							!tabsSelected.has(tab.stableId)
								? 'text-slate-900 dark:text-vercel-accents-5 dark:group-hover:text-white'
								: 'text-slate-900 dark:text-vercel-accents-1 '
						"
					>
						{{ tab.title }}
					</div>
				</button>
			</div>
			<DisclosurePanel class="px-4 text-sm text-slate-500">
				<!-- <ul role="list" class="mt-2 space-y-4 border-l border-slate-200 pl-6"> -->
				<ul role="list" class="mt-2 pl-2">
					<li v-for="(historyEvent, index) in tabHistory" :key="historyEvent.id">
						<div class="grid grid-cols-12">
							<div
								class="false relative col-span-12 flex flex-col gap-8 border-slate-200 pb-1 lg:pl-8"
							>
								<div
									class="absolute left-0 top-[4px] h-full"
									:class="{
										' border-l border-slate-200': index !== tabHistory.length - 1,
									}"
								></div>
								<div class="flex flex-col gap-4 pl-4 lg:pl-0">
									<div
										class="absolute mt-[4px] -ml-[21px] h-3 w-3 rounded-full border border-slate-100 bg-slate-300 lg:-ml-[37.5px]"
									></div>
									<div class="flex items-end justify-between">
										<div class="dark:text-vercel-accents-4">
											{{ historyEvent.humanDistance }} ago
										</div>
										<div
											class="text-sm ordinal slashed-zero tabular-nums text-slate-400 dark:text-vercel-accents-5"
										>
											{{ historyEvent.dateTime }}
										</div>
										<!-- <span
                      class="text-purple-1100 inline-flex items-center rounded-full border border-purple-700 bg-purple-200 bg-opacity-10 px-2.5 py-0.5 text-xs font-medium"
                    >
                      Not shipped yet
                    </span> -->
									</div>
									<!-- <h4 class="text-scale-1200 text-2xl md:text-3xl lg:text-4xl">
                    Monday 08:00 PT | 11:00 ET
                  </h4> -->
								</div>
								<div class=""></div>
							</div>
						</div>

						<!-- <pre>{{ historyEvent }}</pre> -->
						<!-- {{ historyEvent.dateTime }} | {{ historyEvent.humanDistance }} -->
					</li>
				</ul>
			</DisclosurePanel>
		</Disclosure>
	</li>
</template>
