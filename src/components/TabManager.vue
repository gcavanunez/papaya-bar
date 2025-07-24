<script setup lang="ts">
import { ChevronDownIcon, MagnifyingGlassIcon, PencilSquareIcon } from '@heroicons/vue/20/solid'
import { HomeIcon, TagIcon, RectangleGroupIcon, CalendarDaysIcon, Squares2X2Icon, ListBulletIcon } from '@heroicons/vue/24/outline'
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
const isListView = ref(false)
const selectedTabIndex = ref(0)

const focusOnInput = () => {
	if (inputRef.value) {
		inputRef.value.focus()
	}
}

const goToTab = (tab: Tab) => {
	if (tab.id && typeof chrome !== 'undefined') {
		chrome.tabs.update(tab.id, { active: true })
		chrome.windows.update(tab.windowId, { focused: true })
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
const isInputFocused = computed(() => activeElement.value === inputRef.value)
const { shift, ctrl, escape, a, m, w, g, j, k, n, p, enter } = useMagicKeys()

// Get flattened tabs for navigation
const flatTabs = computed(() => {
	return Object.values(grouped.value).flatMap((group) => group)
})

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

// Scroll selected item into view
const scrollToSelectedTab = () => {
	if (isListView.value && selectedTabIndex.value >= 0) {
		const selectedElement = document.querySelector(`[data-tab-index="${selectedTabIndex.value}"]`)
		if (selectedElement) {
			selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
		}
	}
}

// Keyboard navigation for list view
watchEffect(() => {
	if (!isInputFocused.value || !isListView.value || flatTabs.value.length === 0) {
		return
	}
	
	// Navigate down with Ctrl+J or Ctrl+N
	if (ctrl.value && (j.value || n.value)) {
		selectedTabIndex.value = Math.min(selectedTabIndex.value + 1, flatTabs.value.length - 1)
		scrollToSelectedTab()
	}
	
	// Navigate up with Ctrl+K or Ctrl+P
	if (ctrl.value && (k.value || p.value)) {
		selectedTabIndex.value = Math.max(selectedTabIndex.value - 1, 0)
		scrollToSelectedTab()
	}
	
	// Navigate to selected tab with Enter
	if (enter.value && flatTabs.value[selectedTabIndex.value]) {
		const selectedTab = flatTabs.value[selectedTabIndex.value]
		if (selectedTab) {
			goToTab(selectedTab)
		}
	}
})

// Reset selected tab index when switching views or search changes
watchEffect(() => {
	selectedTabIndex.value = 0
})
</script>

<template>
	<div class="relative">
		<div class="container mx-auto max-w-7xl px-4 py-6 sm:px-2">
			<div class="px-4 sm:px-6 lg:px-8">
				<!-- Header Section -->
				<div class="sm:flex sm:items-center">
					<div class="sm:flex-auto">
						<h1 class="text-xl font-semibold text-slate-900 dark:text-white">
							Tab Manager
						</h1>
						<p class="mt-2 text-sm text-slate-700 dark:text-vercel-accents-5">
							Manage and organize your browser tabs
						</p>
					</div>
				</div>

					<!-- Navigation and Search -->
				<div class="mt-6 space-y-4">
					<!-- Navigation Pills -->
					<div class="flex items-center justify-between">
						<TabGroup :selected-index="selectedTab" @change="changeTab">
							<TabList class="flex space-x-1">
								<AppTab
									v-for="[category, values] in Object.entries(categories)"
									:key="category"
									v-slot="{ selected }"
									as="template"
								>
									<button
										:class="[
											'flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
											'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
											selected
												? 'bg-slate-100 text-slate-900 dark:bg-vercel-accents-2 dark:text-white'
												: 'text-slate-700 hover:text-slate-900 dark:text-vercel-accents-5 dark:hover:text-white',
										]"
									>
										<component
											:is="values.icon"
											:class="[
												'h-4 w-4',
												selected
													? 'text-slate-900 dark:text-white'
													: 'text-slate-500 dark:text-vercel-accents-4',
											]"
										/>
										<span>{{ category }}</span>
									</button>
								</AppTab>
							</TabList>
						</TabGroup>

						<!-- View Toggle -->
						<div class="flex items-center space-x-1 rounded-md bg-slate-100 p-1 dark:bg-vercel-accents-2">
							<button
								@click="isListView = false"
								:class="[
									'flex items-center space-x-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
									'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
									!isListView
										? 'bg-white text-slate-900 shadow-sm dark:bg-vercel-accents-3 dark:text-white'
										: 'text-slate-600 hover:bg-white/50 dark:text-vercel-accents-4 dark:hover:bg-vercel-accents-3/50',
								]"
							>
								<Squares2X2Icon class="h-4 w-4" />
								<span class="hidden sm:inline">Grid</span>
							</button>
							<button
								@click="isListView = true"
								:class="[
									'flex items-center space-x-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
									'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
									isListView
										? 'bg-white text-slate-900 shadow-sm dark:bg-vercel-accents-3 dark:text-white'
										: 'text-slate-600 hover:bg-white/50 dark:text-vercel-accents-4 dark:hover:bg-vercel-accents-3/50',
								]"
							>
								<ListBulletIcon class="h-4 w-4" />
								<span class="hidden sm:inline">List</span>
							</button>
						</div>
						<!-- Mobile category selector -->
						<div class="sm:hidden">
							<select
								v-model="selectedTab"
								class="rounded-md border-slate-300 bg-white dark:border-vercel-accents-2 dark:bg-black"
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
						<div class="relative flex-1 lg:w-96">
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
								class="block w-full rounded-md border border-slate-300 bg-white py-2 pr-12 pl-10 text-slate-900 placeholder-slate-500 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-vercel-accents-2 dark:bg-black dark:text-white dark:placeholder-slate-400"
								:placeholder="isListView ? 'Search tabs... (Ctrl+J/K to navigate, Enter to open)' : 'Search tabs by title or URL...'"
							/>

							<!-- Search shortcut hint -->
							<div
								v-if="!searchTerm && !isListView"
								class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
							>
								<kbd
									class="inline-flex items-center rounded border border-slate-200 px-2 py-1 font-sans text-xs text-slate-400 dark:border-slate-600 dark:text-slate-500"
								>
									/
								</kbd>
							</div>

							<!-- Navigation hint for list view -->
							<div
								v-if="!searchTerm && isListView"
								class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
							>
								<div class="flex items-center space-x-1">
									<kbd
										class="inline-flex items-center rounded border border-slate-200 px-1.5 py-0.5 font-sans text-xs text-slate-400 dark:border-slate-600 dark:text-slate-500"
									>
										Ctrl+J/K
									</kbd>
									<span class="text-xs text-slate-400 dark:text-slate-500">navigate</span>
								</div>
							</div>

							<!-- Search results counter and clear -->
							<div
								v-if="totalTabs > 0 && searchTerm"
								class="absolute inset-y-0 right-0 flex items-center pr-3"
							>
								<div class="flex items-center space-x-1">
									<span
										class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-vercel-accents-2 dark:text-vercel-accents-4"
									>
										{{ totalTabs }} results
									</span>
									<button
										@click="searchTerm = ''"
										class="rounded-md p-1 transition-colors hover:bg-slate-100 dark:hover:bg-vercel-accents-2"
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
									class="inline-flex items-center space-x-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-vercel-accents-2 dark:bg-black dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-1"
								>
									<FunnelIcon class="h-4 w-4" />
									<span class="hidden sm:inline">Filters</span>
								</button>
							</PopoverButton>
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
									class="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-lg ring-1 ring-black ring-opacity-5 dark:border-vercel-accents-2 dark:bg-black"
								>
									<button
										@click="close"
										class="absolute top-4 right-4 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-vercel-accents-2 dark:hover:text-slate-300"
									>
										<XMarkIcon class="h-4 w-4" />
									</button>
									<div class="space-y-6">
										<div class="flex items-center justify-between">
											<label
												class="text-sm font-medium text-slate-700 dark:text-vercel-accents-5"
											>
												Date Range Filter
											</label>
											<Switch
												v-model="filter.has_date_range"
												:class="[
													filter.has_date_range
														? 'bg-blue-600'
														: 'bg-slate-200 dark:bg-vercel-accents-3',
													'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
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
														class="mb-3 text-sm font-medium text-slate-700 dark:text-vercel-accents-5"
													>
														Range Type
													</RadioGroupLabel>
													<div
														class="grid grid-cols-5 gap-1 rounded-md bg-slate-100 p-1 dark:bg-vercel-accents-2"
													>
														<RadioGroupOption
															v-for="timeRange in ranges"
															:key="timeRange.value"
															v-slot="{ checked }"
															:value="timeRange.value"
														>
															<button
																:class="[
																	'flex w-full justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
																	'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
																	checked
																		? 'bg-white text-slate-900 shadow-sm dark:bg-vercel-accents-3 dark:text-white'
																		: 'text-slate-600 hover:bg-white/50 dark:text-vercel-accents-4 dark:hover:bg-vercel-accents-3/50',
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
													class="mb-3 block text-sm font-medium text-slate-700 dark:text-vercel-accents-5"
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
																		class="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-10 text-slate-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-vercel-accents-2 dark:bg-black dark:text-white"
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
																		class="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-10 text-slate-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-vercel-accents-2 dark:bg-black dark:text-white"
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
																		class="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-10 text-slate-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-vercel-accents-2 dark:bg-black dark:text-white"																	type="text"
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

				<!-- Main Content Area -->
				<div class="mt-8 flex flex-col">
					<div class="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
						<div class="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
							<!-- Grid View -->
							<div v-if="!isListView && Object.values(grouped).some((row) => row.length)" class="space-y-6">
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
												class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:border dark:border-vercel-accents-2 md:rounded-lg"
											>
												<!-- Group Header -->
												<div
													class="group bg-slate-50 px-6 py-3.5 dark:bg-black"
												>
													<div class="flex items-center justify-between">
														<div class="flex items-center space-x-3">
															<DisclosureButton as="template">
																<button
																	class="flex items-center space-x-2 text-left text-sm font-semibold text-slate-900 dark:text-vercel-accents-6"
																>
																	<span>{{ index }}</span>
																	<span class="text-slate-500 dark:text-vercel-accents-4">({{ group.length }})</span>
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
												class="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
											>
												Select All
											</button>
											<button
												@click="closeTabs(group)"
												class="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
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
													<span class="rounded-md bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50">
														Move
													</span>
												</template>
											</TabMoveToMenu>
											<button
												@click="copyLinks(group)"
												class="rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
											>
												Copy
											</button>
											<DisclosureButton as="template">
												<button
													class="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-vercel-accents-2 dark:hover:text-slate-300"
												>
													<ChevronDownIcon
														class="h-4 w-4 transition-transform duration-200"
														:class="{ 'rotate-180': open }"
													/>
												</button>
											</DisclosureButton>
										</div>													</div>
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
								</transition>											</div>
										</Disclosure>
									</div>
								</transition-group>
							</div>

							<!-- List View -->
							<div v-else-if="isListView && Object.values(grouped).some((row) => row.length)" class="space-y-4">
								<div class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:border dark:border-vercel-accents-2 md:rounded-lg">
									<div class="bg-white dark:bg-black">
										<div class="space-y-0">
											<div
												v-for="(tab, tabIndex) in flatTabs"
												:key="`${tab.windowId}-${tab.stableId}`"
												:data-tab-index="tabIndex"
												:class="[
													'group relative flex items-center space-x-4 border-b border-slate-200 px-6 py-4 transition-colors dark:border-vercel-accents-2',
													tabIndex === selectedTabIndex && isInputFocused
														? 'bg-blue-50 ring-2 ring-blue-500 ring-inset dark:bg-blue-900/20 dark:ring-blue-400'
														: 'hover:bg-slate-50 dark:hover:bg-vercel-accents-1',
													tabsSelected.has(tab.stableId)
														? 'bg-slate-100 dark:bg-vercel-accents-2'
														: '',
												]"
											>
												<!-- Selection Checkbox -->
												<div class="flex-shrink-0">
													<input
														type="checkbox"
														:checked="tabsSelected.has(tab.stableId)"
														@change="toggleSelection(tab)"
														class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-vercel-accents-3 dark:bg-black"
													/>
												</div>

												<!-- Tab Favicon -->
												<div class="flex-shrink-0">
													<img
														v-if="tab.favIconUrl"
														:src="tab.favIconUrl"
														:alt="tab.title"
														class="h-4 w-4"
														@error="($event.target as HTMLImageElement).style.display = 'none'"
													/>
													<div
														v-else
														class="h-4 w-4 rounded bg-slate-200 dark:bg-vercel-accents-3"
													></div>
												</div>

												<!-- Tab Info -->
												<div class="min-w-0 flex-1">
													<div class="flex items-center space-x-2">
														<h3 class="truncate text-sm font-medium text-slate-900 dark:text-white">
															{{ tab.title || 'Untitled' }}
														</h3>
														<span
															v-if="tab.groupId && tab.groupId !== -1"
															class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-vercel-accents-2 dark:text-vercel-accents-5"
														>
															{{ groupMap.get(tab.groupId) || 'Unknown Group' }}
														</span>
													</div>
													<p class="truncate text-sm text-slate-500 dark:text-vercel-accents-4">
														{{ tab.url }}
													</p>
												</div>

												<!-- Actions -->
												<div class="flex items-center space-x-2 opacity-0 transition-opacity group-hover:opacity-100">
													<button
														@click="goToTab(tab)"
														class="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
													>
														Go to
													</button>
													<button
														@click="closeTabs([tab])"
														class="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
													>
														Close
													</button>
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>
							<!-- Empty State -->
							<div v-else-if="searchTerm" class="flex flex-col items-center justify-center py-20">
								<div class="mb-6 rounded-full bg-slate-100 p-6 dark:bg-vercel-accents-2">
									<XMarkIcon class="h-12 w-12 text-slate-400 dark:text-slate-500" />
								</div>
								<h3 class="mb-2 text-lg font-medium text-slate-900 dark:text-white">
									No results found
								</h3>
								<p class="max-w-md text-center text-slate-600 dark:text-vercel-accents-4">
									No tabs match your search for
									<span class="font-semibold text-slate-900 dark:text-white"
										>"{{ searchTerm }}"</span
									>. Try adjusting your search terms or filters.
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Selection Footer -->
	<div v-if="[...tabsSelected].length > 0" class="fixed right-0 bottom-0 left-0 z-50 p-4">
		<div class="mx-auto max-w-7xl">
			<div
				class="rounded-lg border border-slate-200 bg-white p-4 shadow-lg ring-1 ring-black ring-opacity-5 dark:border-vercel-accents-2 dark:bg-black"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center space-x-3">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-900 dark:bg-vercel-accents-2 dark:text-white"
						>
							<span class="text-sm font-semibold">{{
								[...tabsSelected].length
							}}</span>
						</div>
						<span class="font-medium text-slate-900 dark:text-white">
							{{ [...tabsSelected].length === 1 ? 'tab' : 'tabs' }} selected
						</span>
					</div>

					<div class="flex items-center space-x-2">
						<button
							@click="closeUnSelectedTabs"
							class="rounded-md bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-500/20 dark:text-orange-400"
						>
							Close others
						</button>
						<button
							@click="closeSelectedTabs"
							class="rounded-md bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
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
									class="rounded-md bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-500/20 dark:text-purple-400"
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
							class="rounded-md bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
						>
							Save session
						</button>
						<button
							@click="copyLinks(selectedGroup)"
							class="rounded-md bg-green-500/10 px-3 py-2 text-sm font-medium text-green-600 transition-colors hover:bg-green-500/20 dark:text-green-400"
						>
							Copy links
						</button>
						<button
							@click="tabsSelected.clear()"
							class="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-vercel-accents-2 dark:hover:text-white"
						>
							<XMarkIcon class="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
