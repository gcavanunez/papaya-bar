<script setup lang="ts">
import { MagnifyingGlassIcon } from '@heroicons/vue/20/solid'
import { HomeIcon, TagIcon, RectangleGroupIcon, CalendarDaysIcon } from '@heroicons/vue/24/outline'

import { computed, onMounted, reactive, ref, watchEffect } from 'vue'
import { XMarkIcon, FunnelIcon, ChevronDownIcon } from '@heroicons/vue/20/solid'

import { Switch } from '@headlessui/vue'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { TabGroup, TabList, Tab as AppTab } from '@headlessui/vue'
import { RadioGroup, RadioGroupLabel, RadioGroupOption } from '@headlessui/vue'

import { copyToClipboard } from '../utils'
import AppBtn from '@/components/AppBtn.vue'
import { Tab, Grouped } from '@/types'
import { closeTab, moveTabTo, moveTabs } from '@/helpers'
import TabRow from '@/components/TabRow.vue'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import autoAnimate from '@formkit/auto-animate'
import { format, isAfter, isBefore, isWithinInterval, sub } from 'date-fns'
import { useSessionsData } from '@/hooks/useSessionsData'

const { storeSession } = useSessionsData()
const groupContainer = ref<HTMLElement | null>(null)
const groupHeaders = ref<HTMLElement | null>(null)
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
onMounted(() => {
	if (groupContainer.value) {
		autoAnimate(groupContainer.value, { duration: 150 })
	}
	if (groupHeaders.value) {
		autoAnimate(groupHeaders.value, { duration: 150 })
	}
})
const inputRef = ref<HTMLInputElement | null>(null)
const focusOnInput = () => {
	if (inputRef.value) {
		inputRef.value.focus()
	}
}
onMounted(() => {
	watchEffect((onInvalidate) => {
		const focusSearch = (e: KeyboardEvent) => {
			// if (75 === e.which && (e.ctrlKey || e.metaKey)) {
			//   e.preventDefault()
			//   focusOnInput()
			// }
			if (e.key == '/' && document.activeElement !== inputRef.value) {
				console.log('focusSearch hi')
				e.preventDefault()
				focusOnInput()
			}
			// var n = e.target || e.srcElement,
			//   r = n.tagName
			// n.isContentEditable ||
			//   'INPUT' === r ||
			//   'SELECT' === r ||
			//   'TEXTAREA' === r ||
			//   (191 === e.which && (e.preventDefault(), open()))
		}
		document.addEventListener('keydown', focusSearch)
		onInvalidate(() => {
			document.removeEventListener('keydown', focusSearch)
		})
	})
})

// chrome.tabs
const searchTerm = ref<string>('')
const { loadedTabs, loadedGroups, loadedTabHistory, lookUpTab, windowsMap, initlisteners } =
	useChromeTabs()

const tabsSelected = ref<Set<string>>(new Set())
const groupMap = computed(() => {
	let computedMap = new Map()
	loadedGroups.value.forEach((row) => {
		computedMap.set(row.id, row.title)
	})
	return computedMap
})

const selectedGroup = computed(() => {
	return loadedTabs.value.filter((row) => tabsSelected.value.has(row.stableId))
})
const based = computed(() => {
	return loadedTabs.value.reduce((acc, curr) => {
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
		// other case
		// if (!curr.windowId) {
		//   return acc
		// }

		// const domain =
		//   curr.groupId !== -1 ? groupMap.value.get(curr.groupId) : 'other'
		// const domain = `${curr.windowId}` windowsMap.value
		if (selectedTab.value === 2) {
			const windowName = windowsMap.value.get(curr.windowId)
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
		const tabLog = lookUpTab.value[curr.url!]
		// const tabLog = Object.fromEntries(loadedTabHistory.value.entries())[curr.url!]
		// const tabLog = loadedTabHistory.value.get(curr.url!)
		// const tabLog = curr.lastestHistory
		let latestDateAccessed
		if (!tabLog) {
			latestDateAccessed = 'Other'
		} else {
			const latestFromTab = tabLog![0]
			// const latestFromTab = tabLog
			console.log('----Matching group----')
			latestDateAccessed = latestFromTab?.visitTime
				? format(new Date(latestFromTab.visitTime), 'MM/dd/yyyy')
				: 'Other'
		}

		// const domain = windowName ? windowName : 'Other'
		if (acc[latestDateAccessed]) {
			return { ...acc, [latestDateAccessed]: [...acc[latestDateAccessed], curr] }
		}
		return {
			...acc,
			[latestDateAccessed]: [curr],
		}
	}, {} as Grouped)
})
const historySet = computed(() => {
	let checkSet = new Set<string>()
	// loadedTabHistory.value.forEach((historyRecent,index) =>{
	//   historyRecent.map(row=>{
	//     row.
	//   })
	// })
	for (const [key, value] of loadedTabHistory.value) {
		// Using the default iterator (could be `map.entries()` instead)
		// console.log(`The value for key ${key} is ${value}`);
		let bool = value.some((row) => {
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
		let checkedValues = values.filter((row) => {
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
			return { ...acc, ['other']: [...acc['other'], ...checkedValues] }
		}
		return { ...acc, ['other']: [...checkedValues] }
	}, {} as Grouped)
	// if (selectedTab.value === 0) {
	// return actualGroup
	// }
	return Object.keys(actualGroup)
		.sort()
		.reduce((obj, key) => {
			obj[key] = actualGroup[key]
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
	tabs.forEach((row) => {
		closeTab(row)
	})
}

const copyLinks = (tabs: Tab[]) => {
	const urls = tabs
		.map((row) => [row.url, row.title])
		.reduce((acc, curr) => {
			return `${acc}\n\n${curr[1]}\n${curr[0]}`
		}, '')
	if (urls) {
		copyToClipboard(urls)
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
const closeDuplicates = () => {
	const duplicates = loadedTabs.value.filter(
		(item, index, allTabs) => allTabs.findIndex((withIn) => withIn.url === item.url) != index
	)
	duplicates.forEach(closeTab)
}
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

const tabs = [
	{ name: 'Recent', href: '#', current: true },
	{ name: 'Most Liked', href: '#', current: false },
	{ name: 'Most Answers', href: '#', current: false },
]
</script>

<template>
	<div class="mx-auto max-w-3xl py-8 sm:px-6 lg:grid lg:max-w-7xl lg:grid-cols-12 lg:gap-8 lg:px-8">
		<div class="hidden lg:col-span-2 lg:block">
			<nav aria-label="Sidebar" class="sticky top-4 divide-y divide-slate-300">
				<TabGroup @change="changeTab" :selectedIndex="selectedTab" vertical>
					<TabList class="flex flex-col space-y-1 rounded-lg pb-8">
						<AppTab
							v-for="[category, values] in Object.entries(categories)"
							as="template"
							:key="category"
							v-slot="{ selected }"
						>
							<button
								:class="[
									'flex w-full items-center rounded-md py-2 px-3 text-sm font-medium leading-5 ',
									'ring-papaya-900  focus:outline-none focus-visible:ring-2',
									selected ? 'bg-white text-slate-900 shadow' : 'text-slate-700 hover:bg-slate-50 ',
								]"
							>
								<component
									:is="values.icon"
									:class="[
										selected ? 'text-slate-500' : 'text-slate-400 group-hover:text-slate-500',
										'-ml-1 mr-3 h-6 w-6 flex-shrink-0',
									]"
									aria-hidden="true"
								/>
								<span class="truncate">
									{{ category }}
								</span>
								<!-- {{ category }} -->
							</button>
						</AppTab>
					</TabList>
				</TabGroup>
				<div class="pt-10">
					<p class="px-3 text-sm font-medium text-slate-500" id="quick-actions-headline">
						Quick Actions
					</p>
					<div class="mt-3 space-y-2" aria-labelledby="quick-actions-headline">
						<button
							class="group flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-papaya-900"
							@click="storeSession(loadedTabs)"
						>
							<span class="truncate"> Save session </span>
						</button>
						<button
							class="group flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-papaya-900"
							@click="closeDuplicates"
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
			</nav>
		</div>
		<main class="lg:col-span-8">
			<div class="">
				<div class="">
					<section>
						<div class="">
							<div class="">
								<label for="search" class="sr-only">Search tabs</label>
								<div class="flex rounded-md shadow-sm ring-1 ring-black ring-opacity-5">
									<div class="relative flex flex-grow items-stretch focus-within:z-10">
										<div
											class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
										>
											<MagnifyingGlassIcon class="h-5 w-5 text-slate-400" />
										</div>
										<input
											type="text"
											ref="inputRef"
											autofocus
											id="search"
											v-model="searchTerm"
											class="peer block w-full rounded-none rounded-l-md border-transparent pl-10 shadow-sm focus-visible:border-papaya-900 focus-visible:ring-papaya-900 sm:text-sm"
											placeholder="Search"
										/>
										<div
											class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 peer-focus:hidden"
										>
											<p
												class="inline-flex items-center rounded border border-slate-200 px-2 py-0.5 font-sans text-xs font-medium text-slate-400"
											>
												/
											</p>
										</div>
										<div
											v-if="totalTabs > 0 && searchTerm"
											class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
										>
											<div class="flex">
												<p
													class="inline-flex items-center rounded-l border border-r-0 border-slate-200 px-2 py-0.5 font-sans text-xs font-medium text-slate-400"
												>
													{{ totalTabs }}
												</p>
												<button
													@click="searchTerm = ''"
													class="pointer-events-auto rounded-r border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-400"
												>
													<XMarkIcon class="h-3 w-3 fill-current" />
												</button>
											</div>
										</div>
									</div>

									<Popover class="relative flex h-full">
										<PopoverButton as="template">
											<button
												type="button"
												class="relative -ml-px inline-flex items-center space-x-2 rounded-none rounded-r-md border border-transparent bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100 focus:outline-none focus-visible:border-papaya-900 focus-visible:ring-1 focus-visible:ring-papaya-900"
											>
												<FunnelIcon
													title="Add a Filter"
													class="h-5 w-5 text-slate-400"
												></FunnelIcon>
												<span>Sort</span>
											</button>
										</PopoverButton>
										<!-- <PopoverPanel class="absolute z-10"> -->
										<!-- <div class="grid grid-cols-2">
                          <a href="/analytics">Analytics</a>
                          <a href="/engagement">Engagement</a>
                          <a href="/security">Security</a>
                          <a href="/integrations">Integrations</a>
                        </div> -->
										<!-- x-float.placement.bottom-end.offset="{ offset: 8 }" -->
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
												class="absolute top-full z-10 w-screen max-w-sm transition"
											>
												<!-- wire:ignore.self="" -->
												<div
													class="space-y-6 rounded-xl border border-slate-300 bg-white px-6 py-4 shadow-xl dark:border-slate-700 dark:bg-slate-800"
												>
													<button
														title="Close"
														type="button"
														@click="close"
														class="filament-icon-button absolute top-3 right-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-500/5 focus:bg-slate-500/10 focus:outline-none rtl:right-auto rtl:left-3 dark:hover:bg-slate-300/5"
													>
														<span class="sr-only"> Close </span>
														<svg
															class="filament-icon-button-icon h-5 w-5"
															xmlns="http://www.w3.org/2000/svg"
															fill="none"
															viewBox="0 0 24 24"
															stroke-width="2"
															stroke="currentColor"
															aria-hidden="true"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M6 18L18 6M6 6l12 12"
															></path>
														</svg>
													</button>
													<div class="filament-tables-filters-form space-y-6">
														<div
															class="filament-forms-component-container grid grid-cols-1 gap-6 lg:grid-cols-1"
														>
															<div class="col-span-1">
																<Switch
																	v-model="filter.has_date_range"
																	:class="
																		filter.has_date_range
																			? 'bg-blue-700'
																			: 'bg-slate-300 dark:bg-slate-700'
																	"
																	class="relative inline-flex h-[38px] w-[74px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
																>
																	<span class="sr-only">Use setting</span>
																	<span
																		aria-hidden="true"
																		:class="
																			filter.has_date_range ? 'translate-x-9' : 'translate-x-0'
																		"
																		class="pointer-events-none inline-block h-[34px] w-[34px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
																	/>
																</Switch>
															</div>
															<div class="col-span-1">
																<div
																	class="filament-forms-component-container grid grid-cols-1 gap-6"
																>
																	<div>
																		<RadioGroup v-model="filter.date_range_type">
																			<div class="space-y-2">
																				<RadioGroupLabel>
																					<span
																						class="text-sm font-medium leading-4 text-slate-700 dark:text-slate-300"
																					>
																						Range type
																					</span>
																				</RadioGroupLabel>
																				<div
																					class="grid grid-cols-5 rounded-lg border border-slate-300 bg-slate-300 p-1 shadow-sm dark:bg-slate-700"
																				>
																					<RadioGroupOption
																						v-for="timeRange in ranges"
																						:key="timeRange.value"
																						v-slot="{ checked }"
																						:value="timeRange.value"
																					>
																						<button
																							:class="[
																								'flex w-full justify-center rounded-md py-2 px-3 text-sm font-medium leading-5 text-slate-700',
																								'ring-white ring-opacity-60 ring-offset-2 ring-offset-papaya-900 focus:outline-none focus-visible:ring-2',
																								checked
																									? 'bg-white shadow'
																									: 'text-papaya-500 hover:bg-white/[0.12] hover:text-white',
																							]"
																						>
																							{{ timeRange.label }}
																						</button>
																					</RadioGroupOption>
																				</div>
																			</div>
																		</RadioGroup>
																	</div>
																	<div class="col-span-1">
																		<div class="filament-forms-field-wrapper">
																			<div class="space-y-2">
																				<div class="flex items-center justify-between space-x-2">
																					<label
																						class="filament-forms-field-wrapper-label inline-flex items-center space-x-3"
																						for="time-range"
																					>
																						<span
																							class="text-sm font-medium leading-4 text-slate-700 dark:text-slate-300"
																						>
																							Time Range
																						</span>
																					</label>
																				</div>
																				<div class="flex items-center space-x-1">
																					<div
																						class="min-w-0 flex-1"
																						v-if="ranges[filter.date_range_type].is_range"
																					>
																						<v-date-picker
																							v-model="filter.range"
																							mode="dateTime"
																							:masks="masks"
																							is-range
																							:columns="$screens({ default: 1, lg: 2 })"
																						>
																							<template
																								v-slot="{ inputValue, inputEvents, isDragging }"
																							>
																								<div
																									class="flex flex-col items-center justify-start sm:flex-row"
																								>
																									<div class="relative flex-grow">
																										<svg
																											class="pointer-events-none absolute mx-2 h-full w-4 text-slate-600"
																											fill="none"
																											stroke-linecap="round"
																											stroke-linejoin="round"
																											stroke-width="2"
																											viewBox="0 0 24 24"
																											stroke="currentColor"
																										>
																											<path
																												d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
																											></path>
																										</svg>
																										<input
																											class="w-full flex-grow rounded-md border-slate-300 pl-8 pr-2 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
																											type="text"
																											:class="
																												isDragging
																													? 'text-slate-600'
																													: 'text-slate-900'
																											"
																											:value="inputValue.start"
																											v-on="inputEvents.start"
																										/>
																									</div>
																									<span class="m-2 flex-shrink-0">
																										<svg
																											class="h-4 w-4 stroke-current text-slate-600"
																											viewBox="0 0 24 24"
																										>
																											<path
																												stroke-linecap="round"
																												stroke-linejoin="round"
																												stroke-width="2"
																												d="M14 5l7 7m0 0l-7 7m7-7H3"
																											/>
																										</svg>
																									</span>
																									<div class="relative flex-grow">
																										<svg
																											class="pointer-events-none absolute mx-2 h-full w-4 text-slate-600"
																											fill="none"
																											stroke-linecap="round"
																											stroke-linejoin="round"
																											stroke-width="2"
																											viewBox="0 0 24 24"
																											stroke="currentColor"
																										>
																											<path
																												d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
																											></path>
																										</svg>
																										<input
																											class="w-full flex-grow rounded-md border-slate-300 pl-8 pr-2 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
																											type="text"
																											:class="
																												isDragging
																													? 'text-slate-600'
																													: 'text-slate-900'
																											"
																											:value="inputValue.end"
																											v-on="inputEvents.end"
																										/>
																									</div>
																								</div>
																							</template>
																						</v-date-picker>
																					</div>
																					<div class="min-w-0 flex-1" v-else>
																						<v-date-picker
																							v-model="filter.date"
																							mode="dateTime"
																							:masks="masks"
																						>
																							<template v-slot="{ inputValue, inputEvents }">
																								<div
																									class="flex flex-col items-center justify-start sm:flex-row"
																								>
																									<div class="relative flex-grow">
																										<svg
																											class="pointer-events-none absolute mx-2 h-full w-4 text-slate-600"
																											fill="none"
																											stroke-linecap="round"
																											stroke-linejoin="round"
																											stroke-width="2"
																											viewBox="0 0 24 24"
																											stroke="currentColor"
																										>
																											<path
																												d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
																											></path>
																										</svg>
																										<input
																											id="date"
																											class="w-full flex-grow rounded-md border-slate-300 pl-8 pr-2 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
																											type="text"
																											:value="inputValue"
																											v-on="inputEvents"
																										/>
																									</div>
																								</div>
																							</template>
																						</v-date-picker>
																					</div>
																				</div>
																			</div>
																		</div>
																	</div>
																	<!-- <div class="col-span-1">
                                      <div class="filament-forms-field-wrapper">
                                        <div class="space-y-2">
                                          <div
                                            class="flex items-center justify-between space-x-2"
                                          >
                                            <label
                                              class="filament-forms-field-wrapper-label inline-flex items-center space-x-3"
                                              for="time-range"
                                            >
                                              <span
                                                class="text-sm font-medium leading-4 text-slate-700 dark:text-slate-300"
                                              >
                                                Time Range
                                              </span>
                                            </label>
                                          </div>
        
                                          <div
                                            class="filament-forms-select-component group flex items-center space-x-1"
                                          >
                                            <div class="min-w-0 flex-1">
                                              <select
                                                id="time-range"
                                                class="focus:border-primary-600 focus:ring-primary-600 dark:focus:border-primary-600 block w-full rounded-lg border-slate-300 text-slate-900 shadow-sm transition duration-75 focus:ring-1 focus:ring-inset disabled:opacity-70 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                                              >
                                                <option value="">
                                                  Without deleted records
                                                </option>
        
                                                <option value="1">
                                                  With deleted records
                                                </option>
                                                <option value="0">
                                                  Only deleted records
                                                </option>
                                              </select>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div> -->
																</div>
															</div>
														</div>
														<!-- <div class="text-right">
                                <AppBtn color="primary"> Reset filters </AppBtn>
                              </div> -->
													</div>
												</div>
											</PopoverPanel>
										</transition>
										<!-- </PopoverPanel> -->
									</Popover>
								</div>
							</div>
						</div>
					</section>
				</div>
				<!-- <div class="lg:col-span-3">
					<section aria-labelledby="who-to-follow-heading">
						<div class="rounded-lg bg-white shadow">
							<div class="p-6"></div>
						</div>
					</section>
				</div> -->
			</div>
			<div class="mt-6" v-if="Object.values(grouped).some((row) => row.length)">
				<div class="">
					<div class="px-4 sm:px-0">
						<div class="sm:hidden">
							<label for="question-tabs" class="sr-only">Select a tab</label>
							<select
								id="question-tabs"
								class="block w-full rounded-md border-slate-300 text-base font-medium text-slate-900 shadow-sm focus:border-rose-500 focus:ring-rose-500"
							>
								<option v-for="tab in tabs" :key="tab.name" :selected="tab.current">
									{{ tab.name }}
								</option>
							</select>
						</div>
					</div>
					<div class="">
						<h1 class="sr-only">Recent questions</h1>
						<ul role="list" class="space-y-4" ref="groupContainer">
							<li
								class="divide-y divide-slate-100 rounded-lg bg-white shadow-sm ring-1 ring-black ring-opacity-5"
								v-for="(group, index) in grouped"
								:key="`section-${index}`"
								:id="`section-${index}`"
							>
								<div class="px-4 py-4 md:px-6">
									<h2 class="sr-only">{{ index }}</h2>
									<div class="flex items-center justify-between">
										<AppBtn>
											{{ index }}
										</AppBtn>
										<div class="flex items-center space-x-2">
											<AppBtn @click="selectGroup(group)" type="button"> Select </AppBtn>
											<AppBtn @click="moveTabs(group)" type="button"> Move </AppBtn>
											<AppBtn @click="copyLinks(group)" type="button"> Copy </AppBtn>
											<AppBtn @click="closeTabs(group)" type="button" color="round-primary">
												<XMarkIcon class="h-3 w-3" />
											</AppBtn>
										</div>
									</div>
								</div>
								<ul class="px-4 py-4 md:px-6">
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
								</ul>
							</li>
						</ul>
					</div>
				</div>
			</div>
			<div v-else-if="searchTerm" class="mt-6">
				<div class="flex flex-col items-center py-20 text-sm leading-6 text-slate-600 md:py-32">
					<XMarkIcon class="h-8 w-8" />
					<p class="mt-6">
						No matches for
						<span class="font-semibold text-slate-900">“{{ searchTerm }}”</span>.
					</p>
				</div>
			</div>
		</main>
		<aside
			class="hidden lg:col-span-2 lg:block"
			v-if="Object.values(grouped).some((row) => row.length)"
		>
			<div class="sticky top-4 space-y-4">
				<section aria-labelledby="who-to-follow-heading">
					<div class="lg:h-screen lg:overflow-y-auto">
						<div class="">
							<!-- <div class="rounded-lg bg-white shadow lg:h-screen lg:overflow-y-auto">
						<div class="p-6"> -->
							<h2 id="who-to-follow-heading" class="text-base font-medium text-slate-900">
								Groups
							</h2>
							<ul
								ref="groupHeaders"
								role="list"
								class="mt-4 space-y-4 py-1 text-sm leading-6 text-slate-700"
							>
								<li v-for="(group, index) in grouped" :key="`list-${index}`" class="relative">
									<!-- <div
										class="launch-week-timeline-border absolute left-0 top-[4px] hidden h-full border-l border-slate-200 lg:block"
									></div> -->

									<Disclosure v-slot="{ open }">
										<DisclosureButton
											class="group relative flex w-full items-center justify-between space-x-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 focus:outline-none focus-visible:ring focus-visible:ring-papaya-900 focus-visible:ring-opacity-75"
											:class="
												open
													? 'bg-white text-slate-900 shadow'
													: 'hover:bg-slate-50 hover:text-slate-900'
											"
										>
											<!-- <div
												class="absolute top-[50%] h-3 w-3 rounded-full border border-slate-900 bg-slate-200"
											></div> -->
											<router-link
												:to="{ name: 'index', hash: `#section-${index}` }"
												class="flex min-w-0"
											>
												<span class="truncate"> {{ index }} </span>
											</router-link>
											<div
												class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-800"
											>
												{{ group.length }}
											</div>
										</DisclosureButton>
										<DisclosurePanel class="px-4 text-sm text-slate-500">
											<ul role="list" class="mt-2 space-y-4 border-l border-slate-200 pl-6">
												<li>
													<button @click="moveTabs(group)">New window</button>
												</li>
												<li>
													<button @click="closeTabs(group)">Close all</button>
												</li>
												<li>
													<button @click="copyLinks(group)">Copy all links</button>
												</li>
											</ul>
										</DisclosurePanel>
									</Disclosure>
								</li>
							</ul>
						</div>
					</div>
				</section>
			</div>
		</aside>
	</div>
	<footer
		v-if="[...tabsSelected].length > 0"
		class="sticky bottom-0 left-0 right-0 z-10 w-full bg-slate-900 shadow-lg"
	>
		<div class="mx-auto w-full max-w-7xl px-4 sm:px-2">
			<div class="flex w-full items-center justify-between rounded-lg px-4 py-4 text-lg md:px-6">
				<div class="text-slate-300">{{ [...tabsSelected].length }} Tabs selected</div>
				<div class="flex items-center space-x-2">
					<AppBtn @click="closeTabs(selectedGroup)" type="button" color="primary-dark">
						Close all
					</AppBtn>
					<Menu as="div" class="pointer-events-auto relative inline-flex text-left">
						<MenuButton as="template">
							<AppBtn color="primary-dark">
								Move to
								<ChevronDownIcon class="ml-2 -mr-1 h-3 w-3 text-slate-200" aria-hidden="true" />
							</AppBtn>
						</MenuButton>

						<transition
							enter-active-class="transition duration-100 ease-out"
							enter-from-class="transform scale-95 opacity-0"
							enter-to-class="transform scale-100 opacity-100"
							leave-active-class="transition duration-75 ease-in"
							leave-from-class="transform scale-100 opacity-100"
							leave-to-class="transform scale-95 opacity-0"
						>
							<MenuItems
								class="absolute right-0 bottom-0 z-10 mt-2 w-56 origin-bottom-right divide-y divide-slate-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
							>
								<div class="px-1 py-1">
									<MenuItem
										v-slot="{ active, disabled }"
										:key="`${windowId}-custom-selected`"
										v-for="[windowId, value] in [...windowsMap]"
										@click="
											moveTabTo(selectedGroup, {
												containerId: windowId,
												type: 'window_container',
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
											moveTabTo(selectedGroup, {
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
					</Menu>
					<AppBtn @click="moveTabs(selectedGroup)" color="primary-dark" type="button">
						Move
					</AppBtn>
					<AppBtn @click="storeSession(selectedGroup)" color="primary-dark" type="button">
						Save as session
					</AppBtn>
					<AppBtn @click="copyLinks(selectedGroup)" color="primary-dark" type="button">
						Copy
					</AppBtn>
					<AppBtn @click="tabsSelected.clear()" color="round-dark-primary" type="button">
						<XMarkIcon class="h-3 w-3" />
					</AppBtn>
				</div>
			</div>
		</div>
	</footer>
</template>
