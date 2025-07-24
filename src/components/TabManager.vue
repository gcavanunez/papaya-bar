<script setup lang="ts">
import { ChevronDownIcon, MagnifyingGlassIcon, PencilSquareIcon } from '@heroicons/vue/20/solid'
import { HomeIcon, TagIcon, RectangleGroupIcon, CalendarDaysIcon } from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watchEffect } from 'vue'
import { XMarkIcon, FunnelIcon } from '@heroicons/vue/20/solid'
import { Switch } from '@headlessui/vue'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { TabGroup, TabList, Tab as AppTab } from '@headlessui/vue'
import { RadioGroup, RadioGroupLabel, RadioGroupOption } from '@headlessui/vue'

import { copyToClipboard } from '../utils'
import AppBtn from '@/components/AppBtn.vue'
import { Tab, Grouped, WindowsMap, Group, HistoryMap, LookUpTab } from '@/types'
import { closeTab, moveTabs } from '@/helpers'
import TabRow from '@/components/TabRow.vue'

import { useAutoAnimate } from '@formkit/auto-animate/vue'
import { format, isAfter, isBefore, isWithinInterval, sub } from 'date-fns'
import { useSessionsData } from '@/hooks/useSessionsData'
import TabMoveToMenu from './TabMoveToMenu.vue'
import { useGlobalModals } from '@/hooks/useGlobalModals'

const { onEditGroup, onCreateNewGroup } = useGlobalModals()
const { storeSession } = useSessionsData()

const ranges: Record<string, { value: string; label: string; is_range: boolean }> = {
	'<>': {
		value: '<>',
		label: '<>',
		is_range: true,
	},
	'><': {
		value: '><',
		label: '><',
		is_range: true,
	},
	'=': {
		value: '=',
		label: '=',
		is_range: false,
	},
	'<': {
		value: '<',
		label: '<',
		is_range: false,
	},
	'>': {
		value: '>',
		label: '>',
		is_range: false,
	},
}

const filter = reactive({
	has_date_range: false,
	date_range_type: ranges['<>'].value,
	date: new Date(),
	range: {
		start: sub(new Date(), { days: 1 }),
		end: new Date(),
	},
})
const masks = {
	input: 'YYYY-MM-DD h:mm A',
}
const [_groupHeaders] = useAutoAnimate()
const inputRef = ref<HTMLInputElement | null>(null)
const focusOnInput = () => {
	if (inputRef.value) {
		inputRef.value.focus()
	}
}

watchEffect((onInvalidate) => {
	const focusSearch = (e: KeyboardEvent) => {
		if (e.key == '/' && document.activeElement !== inputRef.value) {
			e.preventDefault()
			focusOnInput()
		}
	}
	document.addEventListener('keydown', focusSearch)
	onInvalidate(() => {
		document.removeEventListener('keydown', focusSearch)
	})
})

const searchTerm = ref<string>('')
const tabsSelected = ref<Set<string>>(new Set())
const categories = {
	All: { icon: HomeIcon },
	Grouped: { icon: TagIcon },
	Windows: { icon: RectangleGroupIcon },
	Date: { icon: CalendarDaysIcon },
}
const changeTab = (index: number) => {
	selectedTab.value = index
}
const selectedTab = ref(0)
const selectedTabName = computed(() => {
	const tabCategory = Object.keys(categories).find((_row, index) => selectedTab.value === index)
	return tabCategory ? tabCategory : 'All'
})

type Props = {
	loadedTabs: Tab[]
	loadedGroups: Group[]
	loadedTabHistory: HistoryMap
	lookUpTab: LookUpTab
	windowsMap: WindowsMap
}
const props = defineProps<Props>()

const groupMap = computed(() => {
	const computedMap = new Map()
	props.loadedGroups.forEach((row) => {
		computedMap.set(row.id, row.title)
	})
	return computedMap
})

const selectedGroup = computed(() => {
	return props.loadedTabs.filter((row) => tabsSelected.value.has(row.stableId))
})
const based = computed(() => {
	return props.loadedTabs.reduce((acc, curr) => {
		if (selectedTab.value === 0) {
			if (!curr.url) {
				return acc
			}
			const domain = new URL(curr.url).hostname
			if (acc[domain]) {
				return { ...acc, [domain]: [...acc[domain], curr] }
			}
			return {
				...acc,
				[domain]: [curr],
			}
		}
		if (selectedTab.value === 1) {
			// other case
			if (!curr.groupId) {
				return acc
			}

			const domain = curr.groupId !== -1 ? groupMap.value.get(curr.groupId) : 'other'

			if (acc[domain]) {
				return { ...acc, [domain]: [...acc[domain], curr] }
			}
			return {
				...acc,
				[domain]: [curr],
			}
		}

		if (selectedTab.value === 2) {
			const windowName = props.windowsMap.get(curr.windowId)
			const domain = windowName ? windowName : 'Other'
			if (acc[domain]) {
				return { ...acc, [domain]: [...acc[domain], curr] }
			}
			return {
				...acc,
				[domain]: [curr],
			}
		}

		// by Date
		// if (selectedTab.value === 3) {}

		// const windowName = windowsMap.value.get(curr.windowId)
		// if(!curr.url){ return }
		const tabLog = props.lookUpTab[curr.url!]
		let latestDateAccessed
		if (!tabLog) {
			latestDateAccessed = 'Other'
		} else {
			const latestFromTab = tabLog![0]
			latestDateAccessed = latestFromTab?.visitTime
				? format(new Date(latestFromTab.visitTime), 'MM/dd/yyyy')
				: 'Other'
		}
		if (acc[latestDateAccessed]) {
			return {
				...acc,
				[latestDateAccessed]: [...acc[latestDateAccessed], curr],
			}
		}
		return {
			...acc,
			[latestDateAccessed]: [curr],
		}
	}, {} as Grouped)
})
const historySet = computed(() => {
	const checkSet = new Set<string>()
	for (const [key, value] of props.loadedTabHistory) {
		const bool = value.some((row) => {
			if ([ranges['<>'].value, ranges['><'].value].includes(filter.date_range_type)) {
				return isWithinInterval(row.visitTime!, {
					end: filter.range.end,
					start: filter.range.start,
				})
			}
			if (filter.date_range_type == ranges['<'].value) {
				return isBefore(row.visitTime!, filter.date)
			}
			if (filter.date_range_type == ranges['>'].value) {
				return isAfter(row.visitTime!, filter.date)
			}
			return isWithinInterval(row.visitTime!, {
				end: filter.date,
				start: sub(filter.date, { days: 1 }),
			})
		})
		if (bool) {
			checkSet.add(key)
		}
	}
	return checkSet
})
// The Logic
const grouped = computed<Grouped>(() => {
	// const based
	const actualGroup = Object.entries(based.value).reduce((acc, [index, values]) => {
		const checkedValues = values.filter((row) => {
			if (!row.title || !row.url) {
				return false
			}
			if (filter.has_date_range) {
				if (!historySet.value.has(row.url)) {
					return false
				}
			}
			return (
				row.title.toLocaleLowerCase().indexOf(searchTerm.value.toLocaleLowerCase()) > -1 ||
				row.url.toLocaleLowerCase().indexOf(searchTerm.value.toLocaleLowerCase()) > -1
			)
		})
		if (checkedValues.length > 1) {
			return { ...acc, [index]: checkedValues }
		}
		if (acc['other']) {
			return {
				...acc,
				['other']: [...acc['other'], ...checkedValues],
			}
		}
		return { ...acc, ['other']: [...checkedValues] }
	}, {} as Grouped)
	// if (selectedTab.value === 0) {
	// return actualGroup
	// }
	return Object.keys(actualGroup)
		.sort((a, b) => {
			return actualGroup[b].length - actualGroup[a].length
		})
		.reduce((obj, key) => {
			if (actualGroup[key].length) {
				obj[key] = actualGroup[key]
			}
			return obj
		}, {} as Grouped)
})
const totalTabs = computed(() => {
	return Object.values(grouped.value)
		.flatMap((row) => row.length)
		.reduce((acc, curr) => {
			return acc + curr
		}, 0)
})

const closeTabs = (tabs: Tab[]) => {
	closeTab(tabs)
}

const closeSelectedTabs = () => {
	closeTab(selectedGroup.value)
	tabsSelected.value.clear()
}
const closeUnSelectedTabs = () => {
	closeTab(props.loadedTabs.filter((row) => !tabsSelected.value.has(row.stableId)))
}

const copyLinks = (tabs: Tab[]) => {
	const urls = tabs
		.map((row) => [row.url, row.title])
		.reduce((acc, curr) => {
			return `${acc}\n\n${curr[1]}\n${curr[0]}`
		}, '')
	if (urls) {
		copyToClipboard(urls)

		toast('Links copied to clipboard')
	}
}

const toggleSelection = (tab: Tab) => {
	if (tabsSelected.value.has(tab.stableId)) {
		tabsSelected.value.delete(tab.stableId)
	} else {
		tabsSelected.value.add(tab.stableId)
	}
}
const selectGroup = (tabs: Tab[]) => {
	tabs.forEach((tab) => {
		tabsSelected.value.add(tab.stableId)
	})
}
import { useActiveElement, useMagicKeys } from '@vueuse/core'
import { toast } from 'vue-sonner'

const activeElement = useActiveElement()
const notUsingInput = computed(
	() => activeElement.value?.tagName !== 'INPUT' && activeElement.value?.tagName !== 'TEXTAREA',
)
const { shift, ctrl, escape, a, m, w, g } = useMagicKeys()

watchEffect(() => {
	if (!notUsingInput.value) {
		return
	}
	if (shift.value && escape.value) {
		tabsSelected.value.clear()
	}
	if (ctrl.value && a.value) {
		tabsSelected.value.clear()
		selectGroup(Object.values(grouped.value).flatMap((row) => row))
	}
	if (shift.value && m.value && w.value) {
		moveTabs(Object.values(grouped.value).flatMap((row) => row))
	}
	if (shift.value && m.value && g.value) {
		onCreateNewGroup({
			tabs: Object.values(grouped.value).flatMap((row) => row),
		})
	}
})
</script>

<template>
	<div
		class="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
	>
		<!-- Header Section -->
		<div
			class="sticky top-0 z-40 border-b border-slate-200/50 bg-white/80 backdrop-blur-xl dark:border-slate-700/50 dark:bg-slate-900/80"
		>
			<div class="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
				<!-- Navigation Pills -->
				<div class="mb-6 flex items-center justify-between">
					<TabGroup :selected-index="selectedTab" @change="changeTab">
						<TabList
							class="flex space-x-1 rounded-xl bg-slate-100/50 p-1 backdrop-blur-sm dark:bg-slate-800/50"
						>
							<AppTab
								v-for="[category, values] in Object.entries(categories)"
								:key="category"
								v-slot="{ selected }"
								as="template"
							>
								<button
									:class="[
										'flex items-center space-x-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
										'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
										selected
											? 'scale-105 bg-white text-slate-900 shadow-lg shadow-slate-200/50 dark:bg-slate-700 dark:text-white dark:shadow-slate-900/50'
											: 'text-slate-600 hover:bg-white/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-white',
									]"
								>
									<component
										:is="values.icon"
										:class="[
											'h-4 w-4 transition-colors',
											selected
												? 'text-blue-600 dark:text-blue-400'
												: 'text-slate-500 dark:text-slate-400',
										]"
									/>
									<span>{{ category }}</span>
								</button>
							</AppTab>
						</TabList>
					</TabGroup>

					<!-- Mobile category selector -->
					<div class="sm:hidden">
						<select
							v-model="selectedTab"
							class="rounded-lg border-slate-300 bg-white/80 backdrop-blur-sm dark:border-slate-600 dark:bg-slate-800/80"
						>
							<option
								v-for="(tab, index) in Object.keys(categories)"
								:key="tab"
								:value="index"
							>
								{{ tab }}
							</option>
						</select>
					</div>
				</div>

				<!-- Search and Filter Bar -->
				<div class="flex items-center space-x-4">
					<div class="relative flex-1">
						<div
							class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
						>
							<MagnifyingGlassIcon
								class="h-5 w-5 text-slate-400 dark:text-slate-500"
							/>
						</div>
						<input
							id="search"
							ref="inputRef"
							v-model="searchTerm"
							type="text"
							autofocus
							class="block w-full rounded-xl border border-slate-200/50 bg-white/80 py-3 pr-12 pl-10 text-slate-900 placeholder-slate-500 backdrop-blur-sm transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/50 dark:border-slate-700/50 dark:bg-slate-800/80 dark:text-white dark:placeholder-slate-400"
							placeholder="Search tabs by title or URL..."
						/>

						<!-- Search shortcut hint -->
						<div
							v-if="!searchTerm"
							class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
						>
							<kbd
								class="inline-flex items-center rounded border border-slate-200 px-2 py-1 font-sans text-xs text-slate-400 dark:border-slate-600 dark:text-slate-500"
							>
								/
							</kbd>
						</div>

						<!-- Search results counter and clear -->
						<div
							v-if="totalTabs > 0 && searchTerm"
							class="absolute inset-y-0 right-0 flex items-center pr-3"
						>
							<div class="flex items-center space-x-1">
								<span
									class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400"
								>
									{{ totalTabs }} results
								</span>
								<button
									@click="searchTerm = ''"
									class="rounded-md p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
								>
									<XMarkIcon class="h-4 w-4 text-slate-400 dark:text-slate-500" />
								</button>
							</div>
						</div>
					</div>

					<!-- Filter Button -->
					<Popover class="relative">
						<PopoverButton as="template">
							<button
								type="button"
								class="inline-flex items-center space-x-2 rounded-xl border border-slate-200/50 bg-white/80 px-4 py-3 text-slate-700 backdrop-blur-sm transition-all duration-200 hover:bg-white focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-slate-700/50 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-700"
							>
								<FunnelIcon class="h-4 w-4" />
								<span class="hidden sm:inline">Filters</span>
							</button>
						</PopoverButton>
						<!-- <PopoverPanel class="absolute z-10"> -->
						<!-- <div class="grid grid-cols-2">
                            <a href="/analytics">Analytics</a>
                            <a href="/engagement">Engagement</a>
                            <a href="/security">Security</a>
                            <a href="/integrations">Integrations</a>
                          </div> -->
						<transition
							enter-active-class="transition duration-200 ease-out"
							enter-from-class="translate-y-1 opacity-0"
							enter-to-class="translate-y-0 opacity-100"
							leave-active-class="transition duration-150 ease-in"
							leave-from-class="translate-y-0 opacity-100"
							leave-to-class="translate-y-1 opacity-0"
						>
							<PopoverPanel
								v-slot="{ close }"
								class="absolute top-full right-0 z-50 mt-2 w-80"
							>
								<div
									class="space-y-6 rounded-xl border border-slate-200/50 bg-white/95 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-slate-700/50 dark:bg-slate-800/95 dark:shadow-slate-900/20"
								>
									<button
										@click="close"
										class="absolute top-4 right-4 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
									>
										<XMarkIcon class="h-4 w-4" />
									</button>
									<div class="space-y-6">
										<div class="flex items-center justify-between">
											<label
												class="text-sm font-medium text-slate-700 dark:text-slate-300"
											>
												Date Range Filter
											</label>
											<Switch
												v-model="filter.has_date_range"
												:class="[
													filter.has_date_range
														? 'bg-blue-600'
														: 'bg-slate-200 dark:bg-slate-600',
													'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
												]"
											>
												<span
													:class="[
														filter.has_date_range
															? 'translate-x-5'
															: 'translate-x-0',
														'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
													]"
												/>
											</Switch>
										</div>
										<div v-if="filter.has_date_range" class="space-y-4">
											<div>
												<RadioGroup v-model="filter.date_range_type">
													<RadioGroupLabel
														class="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300"
													>
														Range Type
													</RadioGroupLabel>
													<div
														class="grid grid-cols-5 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-700"
													>
														<RadioGroupOption
															v-for="timeRange in ranges"
															:key="timeRange.value"
															v-slot="{ checked }"
															:value="timeRange.value"
														>
															<button
																:class="[
																	'flex w-full justify-center rounded-md px-3 py-2 text-sm font-medium transition-all duration-200',
																	'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
																	checked
																		? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
																		: 'text-slate-600 hover:bg-white/50 dark:text-slate-400 dark:hover:bg-slate-600/50',
																]"
															>
																{{ timeRange.label }}
															</button>
														</RadioGroupOption>
													</div>
												</RadioGroup>
											</div>
											<div>
												<label
													class="mb-3 block text-sm font-medium text-slate-700 dark:text-slate-300"
												>
													Time Range
												</label>
												<div v-if="ranges[filter.date_range_type].is_range">
													<v-date-picker
														v-model="filter.range"
														mode="dateTime"
														:masks="masks"
														is-range
													>
														<template
															#default="{
																inputValue,
																inputEvents,
																isDragging,
															}"
														>
															<div
																class="flex flex-col gap-3 sm:flex-row"
															>
																<div class="relative flex-1">
																	<CalendarDaysIcon
																		class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-slate-400"
																	/>
																	<input
																		class="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-10 text-slate-900 transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
																		type="text"
																		:class="
																			isDragging
																				? 'text-slate-600'
																				: 'text-slate-900 dark:text-white'
																		"
																		:value="inputValue.start"
																		v-on="inputEvents.start"
																		placeholder="Start date"
																	/>
																</div>
																<div
																	class="flex items-center justify-center"
																>
																	<svg
																		class="h-4 w-4 text-slate-400"
																		viewBox="0 0 24 24"
																		fill="none"
																		stroke="currentColor"
																	>
																		<path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M14 5l7 7m0 0l-7 7m7-7H3"
																		/>
																	</svg>
																</div>
																<div class="relative flex-1">
																	<CalendarDaysIcon
																		class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-slate-400"
																	/>
																	<input
																		class="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-10 text-slate-900 transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
																		type="text"
																		:class="
																			isDragging
																				? 'text-slate-600'
																				: 'text-slate-900 dark:text-white'
																		"
																		:value="inputValue.end"
																		v-on="inputEvents.end"
																		placeholder="End date"
																	/>
																</div>
															</div>
														</template>
													</v-date-picker>
												</div>
												<div v-else>
													<v-date-picker
														v-model="filter.date"
														mode="dateTime"
														:masks="masks"
													>
														<template
															#default="{ inputValue, inputEvents }"
														>
															<div class="relative">
																<CalendarDaysIcon
																	class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-slate-400"
																/>
																<input
																	class="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-10 text-slate-900 transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
																	type="text"
																	:value="inputValue"
																	v-on="inputEvents"
																	placeholder="Select date"
																/>
															</div>
														</template>
													</v-date-picker>
												</div>
											</div>
										</div>
									</div>
								</div>
							</PopoverPanel>
						</transition>
					</Popover>
				</div>
			</div>
		</div>

		<!-- Main Content Area -->
		<div class="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
			<!-- Tab Groups Grid -->
			<div v-if="Object.values(grouped).some((row) => row.length)" class="space-y-6 pt-8">
				<transition-group
					appear
					enter-active-class="transition duration-300 ease-out"
					enter-from-class="transform scale-95 opacity-0 translate-y-4"
					enter-to-class="transform scale-100 opacity-100 translate-y-0"
					leave-active-class="transition duration-200 ease-in"
					leave-from-class="transform scale-100 opacity-100 translate-y-0"
					leave-to-class="transform scale-95 opacity-0 translate-y-4"
				>
					<div
						v-for="(group, index) in grouped"
						:id="`section-${index}`"
						:key="`section-${index}`"
						class="relative"
					>
						<Disclosure v-slot="{ open }" :default-open="true">
							<!-- Group Card -->
							<div
								class="overflow-hidden rounded-2xl border border-slate-200/50 bg-white/70 shadow-lg shadow-slate-200/20 backdrop-blur-xl transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/30 dark:border-slate-700/50 dark:bg-slate-800/70 dark:shadow-slate-900/20 dark:hover:shadow-slate-900/30"
							>
								<!-- Group Header -->
								<div
									class="group border-b border-slate-200/50 bg-gradient-to-r from-slate-50/50 to-blue-50/50 px-6 py-4 dark:border-slate-700/50 dark:from-slate-800/50 dark:to-slate-700/50"
								>
									<div class="flex items-center justify-between">
										<div class="flex items-center space-x-3">
											<DisclosureButton as="template">
												<button
													class="flex items-center space-x-2 rounded-xl border border-slate-200/50 bg-white/80 px-4 py-2 font-medium text-slate-900 backdrop-blur-sm transition-all duration-200 hover:bg-white focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-slate-600/50 dark:bg-slate-700/80 dark:text-white dark:hover:bg-slate-600"
												>
													<span class="text-sm">{{ index }}</span>
													<div
														class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-600 dark:bg-blue-900/50 dark:text-blue-400"
													>
														{{ group.length }}
													</div>
												</button>
											</DisclosureButton>

											<AppBtn
												v-if="
													selectedTabName === 'Grouped' &&
													index !== 'other'
												"
												color="round-primary"
												type="button"
												@click="onEditGroup({ tabs: group })"
												class="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
											>
												<PencilSquareIcon class="h-4 w-4" />
											</AppBtn>
										</div>

										<!-- Action Buttons -->
										<div class="flex items-center space-x-2">
											<button
												@click="selectGroup(group)"
												class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
											>
												Select All
											</button>
											<button
												@click="closeTabs(group)"
												class="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
											>
												Close
											</button>
											<TabMoveToMenu
												:tabs="group"
												:windows-map="windowsMap"
												:loaded-groups="loadedGroups"
												@on-create-group="
													({ tabs: emitedTabs }) =>
														onCreateNewGroup({ tabs: emitedTabs })
												"
											>
												<template #menu-trigger-label>
													<!-- <span -->
													<!-- 	class="rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:bg-slate-700/50 dark:text-slate-400 dark:hover:bg-slate-600" -->
													<!-- > -->
													Move
													<!-- </span> -->
												</template>
											</TabMoveToMenu>
											<button
												@click="copyLinks(group)"
												class="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
											>
												Copy
											</button>
											<DisclosureButton as="template">
												<button
													class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
												>
													<ChevronDownIcon
														class="h-4 w-4 transition-transform duration-200"
														:class="{ 'rotate-180': open }"
													/>
												</button>
											</DisclosureButton>
										</div>
									</div>
								</div>

								<!-- Tabs List -->
								<transition
									enter-active-class="transition duration-200 ease-out"
									enter-from-class="opacity-0 -translate-y-2"
									enter-to-class="opacity-100 translate-y-0"
									leave-active-class="transition duration-150 ease-in"
									leave-from-class="opacity-100 translate-y-0"
									leave-to-class="opacity-0 -translate-y-2"
								>
									<DisclosurePanel class="px-6 py-4">
										<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
											<TabRow
												v-for="tab in group"
												:key="`${tab.windowId}-${tab.stableId}`"
												:tab="tab"
												:windows-map="windowsMap"
												:loaded-groups="loadedGroups"
												:tabs-selected="tabsSelected"
												:history="loadedTabHistory"
												@toggle-selection="toggleSelection"
											/>
										</div>
									</DisclosurePanel>
								</transition>
							</div>
						</Disclosure>
					</div>
				</transition-group>
			</div>
			<!-- Empty State -->
			<div v-else-if="searchTerm" class="flex flex-col items-center justify-center py-20">
				<div class="mb-6 rounded-full bg-slate-100 p-6 dark:bg-slate-800">
					<XMarkIcon class="h-12 w-12 text-slate-400 dark:text-slate-500" />
				</div>
				<h3 class="mb-2 text-lg font-medium text-slate-900 dark:text-white">
					No results found
				</h3>
				<p class="max-w-md text-center text-slate-600 dark:text-slate-400">
					No tabs match your search for
					<span class="font-semibold text-slate-900 dark:text-white"
						>"{{ searchTerm }}"</span
					>. Try adjusting your search terms or filters.
				</p>
			</div>
		</div>
	</div>

	<!-- Selection Footer -->
	<div v-if="[...tabsSelected].length > 0" class="fixed right-0 bottom-0 left-0 z-50 p-4">
		<div class="mx-auto max-w-7xl">
			<div
				class="rounded-2xl border border-slate-700/50 bg-slate-900/95 p-4 shadow-2xl shadow-slate-900/20 backdrop-blur-xl dark:bg-slate-800/95"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center space-x-3">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400"
						>
							<span class="text-sm font-semibold">{{
								[...tabsSelected].length
							}}</span>
						</div>
						<span class="font-medium text-white">
							{{ [...tabsSelected].length === 1 ? 'tab' : 'tabs' }} selected
						</span>
					</div>

					<div class="flex items-center space-x-2">
						<button
							@click="closeUnSelectedTabs"
							class="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
						>
							Close others
						</button>
						<button
							@click="closeSelectedTabs"
							class="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
						>
							Close selected
						</button>
						<TabMoveToMenu
							:tabs="selectedGroup"
							:loaded-groups="loadedGroups"
							:windows-map="windowsMap"
							@on-create-group="
								({ tabs: emitedTabs }) => onCreateNewGroup({ tabs: emitedTabs })
							"
						>
							<template #button-trigger="{ trigger }">
								<button
									:ref="
										(el) =>
											trigger(
												el && '$el' in el
													? (el.$el as HTMLElement)
													: (el as HTMLElement),
											)
									"
									class="rounded-lg bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/20"
								>
									Move to
								</button>
							</template>
						</TabMoveToMenu>
						<button
							@click="
								() => {
									storeSession(selectedGroup)
									toast('Session saved')
								}
							"
							class="rounded-lg bg-green-500/10 px-3 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/20"
						>
							Save session
						</button>
						<button
							@click="copyLinks(selectedGroup)"
							class="rounded-lg bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-400 transition-colors hover:bg-purple-500/20"
						>
							Copy links
						</button>
						<button
							@click="tabsSelected.clear()"
							class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
						>
							<XMarkIcon class="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
