<script setup lang="ts">
import { computed, onMounted, reactive, ref, watchEffect } from 'vue'
import { XMarkIcon, FunnelIcon, ChevronDownIcon } from '@heroicons/vue/20/solid'

import { Switch } from '@headlessui/vue'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { TabGroup, TabList, Tab as AppTab } from '@headlessui/vue'
import { RadioGroup, RadioGroupLabel, RadioGroupOption } from '@headlessui/vue'

import { ChevronUpIcon } from '@heroicons/vue/20/solid'
import { copyToClipboard } from '../utils'
import AppBtn from '@/components/AppBtn.vue'
import { Tab, Grouped } from '@/types'
import { closeTab, moveTabTo, moveTabs } from '@/helpers'
import TabRow from '@/components/TabRow.vue'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useAutoAnimate } from '@formkit/auto-animate/vue'
import { format, isAfter, isBefore, isWithinInterval, sub } from 'date-fns'
import { useSessionsData } from '@/hooks/useSessionsData'

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

const [groupHeaders] = useAutoAnimate()
const [groupContainer] = useAutoAnimate()
const changeTab = (index: number) => {
	selectedTab.value = index
}
const selectedTab = ref(0)
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
const categories = ref({
	All: [],
	Grouped: [],
	Windows: [],
	Date: [],
})
// chrome.tabs
const searchTerm = ref<string>('')
const { loadedTabs, loadedGroups, loadedTabHistory, lookUpTab, windowsMap, initlisteners } =
	useChromeTabs()

initlisteners()

const tabsSelected = ref<Set<string>>(new Set())
const groupMap = computed(() => {
	const computedMap = new Map()
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
	const checkSet = new Set<string>()
	// loadedTabHistory.value.forEach((historyRecent,index) =>{
	//   historyRecent.map(row=>{
	//     row.
	//   })
	// })
	for (const [key, value] of loadedTabHistory.value) {
		// Using the default iterator (could be `map.entries()` instead)
		// console.log(`The value for key ${key} is ${value}`);
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
	closeTab(tabs)
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
		(item, index, allTabs) => allTabs.findIndex((withIn) => withIn.url === item.url) != index,
	)

	closeTab(duplicates)
}
</script>

<template>
	<div class="relative bg-slate-100">
		<header
			class="firefox:bg-opacity-90 bg-opacity-50 sticky top-0 z-30 flex h-[72px] items-center bg-slate-100 backdrop-blur backdrop-filter"
		>
			<div class="container mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-2">
				<div class="">
					<router-link :to="{ name: 'index', hash: `#head` }">
						<h1 class="text-2xl text-slate-700">Swift Bar - {{ loadedTabs.length }}</h1>
					</router-link>
					<div class="inline-flex space-x-4">
						<router-link :to="{ name: 'sessions' }"> sessions </router-link>
						<router-link :to="{ name: 'utilities' }"> utils </router-link>
					</div>
				</div>
				<div class="flex w-full max-w-3xl justify-end divide-x divide-slate-300">
					<div class="flex w-full max-w-md shrink items-center gap-2 px-4">
						<div class="w-full">
							<label for="search" class="sr-only">Search tabs</label>
							<div class="relative w-full">
								<input
									id="search"
									ref="inputRef"
									v-model="searchTerm"
									type="text"
									autofocus
									class="peer block w-full rounded-md border-slate-300 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
									placeholder="Search"
								/>
								<div
									class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 peer-focus:hidden"
								>
									<p
										class="inline-flex items-center rounded border border-gray-200 px-2 py-0.5 font-sans text-xs font-medium text-gray-400"
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
											class="inline-flex items-center rounded-l border border-r-0 border-gray-200 px-2 py-0.5 font-sans text-xs font-medium text-gray-400"
										>
											{{ totalTabs }}
										</p>
										<button
											class="pointer-events-auto rounded-r border border-gray-200 bg-slate-50 px-2 py-0.5 text-gray-400"
											@click="searchTerm = ''"
										>
											<XMarkIcon class="h-3 w-3 fill-current" />
										</button>
									</div>
								</div>
							</div>
						</div>
						<Popover class="relative">
							<PopoverButton as="template">
								<AppBtn color="round-white">
									<FunnelIcon
										title="Add a Filter"
										class="h-3 w-3 fill-current text-slate-500"
									></FunnelIcon>
								</AppBtn>
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
										class="space-y-6 rounded-xl border border-gray-300 bg-white px-6 py-4 shadow-xl dark:border-gray-700 dark:bg-gray-800"
									>
										<button
											title="Close"
											type="button"
											class="filament-icon-button absolute top-3 right-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-500/5 focus:bg-gray-500/10 focus:outline-none rtl:right-auto rtl:left-3 dark:hover:bg-gray-300/5"
											@click="close"
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
																: 'bg-slate-300 dark:bg-gray-700'
														"
														class="focus-visible:ring-opacity-75 relative inline-flex h-[38px] w-[74px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
													>
														<span class="sr-only">Use setting</span>
														<span
															aria-hidden="true"
															:class="
																filter.has_date_range
																	? 'translate-x-9'
																	: 'translate-x-0'
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
															<RadioGroup
																v-model="filter.date_range_type"
															>
																<div class="space-y-2">
																	<RadioGroupLabel>
																		<span
																			class="text-sm leading-4 font-medium text-gray-700 dark:text-gray-300"
																		>
																			Range type
																		</span>
																	</RadioGroupLabel>
																	<div
																		class="grid grid-cols-5 rounded-lg border border-slate-300 bg-slate-300 p-1 shadow-sm dark:bg-gray-700"
																	>
																		<RadioGroupOption
																			v-for="timeRange in ranges"
																			:key="timeRange.value"
																			v-slot="{ checked }"
																			:value="timeRange.value"
																		>
																			<button
																				:class="[
																					'flex w-full justify-center rounded-md px-3 py-2 text-sm leading-5 font-medium text-slate-700',
																					'ring-opacity-60 ring-white ring-offset-2 ring-offset-blue-400 focus:outline-none focus-visible:ring-2',
																					checked
																						? 'bg-white shadow'
																						: 'text-blue-50 hover:bg-white/12 hover:text-white',
																				]"
																			>
																				{{
																					timeRange.label
																				}}
																			</button>
																		</RadioGroupOption>
																	</div>
																</div>
															</RadioGroup>
														</div>
														<div class="col-span-1">
															<div
																class="filament-forms-field-wrapper"
															>
																<div class="space-y-2">
																	<div
																		class="flex items-center justify-between space-x-2"
																	>
																		<label
																			class="filament-forms-field-wrapper-label inline-flex items-center space-x-3"
																			for="time-range"
																		>
																			<span
																				class="text-sm leading-4 font-medium text-gray-700 dark:text-gray-300"
																			>
																				Time Range
																			</span>
																		</label>
																	</div>

																	<div
																		class="flex items-center space-x-1"
																	>
																		<div
																			v-if="
																				ranges[
																					filter
																						.date_range_type
																				].is_range
																			"
																			class="min-w-0 flex-1"
																		>
																			<v-date-picker
																				v-model="
																					filter.range
																				"
																				mode="dateTime"
																				:masks="masks"
																				is-range
																				:columns="
																					$screens({
																						default: 1,
																						lg: 2,
																					})
																				"
																			>
																				<template
																					#default="{
																						inputValue,
																						inputEvents,
																						isDragging,
																					}"
																				>
																					<div
																						class="flex flex-col items-center justify-start sm:flex-row"
																					>
																						<div
																							class="relative grow"
																						>
																							<svg
																								class="pointer-events-none absolute mx-2 h-full w-4 text-gray-600"
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
																								class="w-full grow rounded-md border-slate-300 pr-2 pl-8 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
																								type="text"
																								:class="
																									isDragging
																										? 'text-gray-600'
																										: 'text-gray-900'
																								"
																								:value="
																									inputValue.start
																								"
																								v-on="
																									inputEvents.start
																								"
																							/>
																						</div>
																						<span
																							class="m-2 shrink-0"
																						>
																							<svg
																								class="h-4 w-4 stroke-current text-gray-600"
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
																						<div
																							class="relative grow"
																						>
																							<svg
																								class="pointer-events-none absolute mx-2 h-full w-4 text-gray-600"
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
																								class="w-full grow rounded-md border-slate-300 pr-2 pl-8 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
																								type="text"
																								:class="
																									isDragging
																										? 'text-gray-600'
																										: 'text-gray-900'
																								"
																								:value="
																									inputValue.end
																								"
																								v-on="
																									inputEvents.end
																								"
																							/>
																						</div>
																					</div>
																				</template>
																			</v-date-picker>
																		</div>
																		<div
																			v-else
																			class="min-w-0 flex-1"
																		>
																			<v-date-picker
																				v-model="
																					filter.date
																				"
																				mode="dateTime"
																				:masks="masks"
																			>
																				<template
																					#default="{
																						inputValue,
																						inputEvents,
																					}"
																				>
																					<div
																						class="flex flex-col items-center justify-start sm:flex-row"
																					>
																						<div
																							class="relative grow"
																						>
																							<svg
																								class="pointer-events-none absolute mx-2 h-full w-4 text-gray-600"
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
																								class="w-full grow rounded-md border-slate-300 pr-2 pl-8 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
																								type="text"
																								:value="
																									inputValue
																								"
																								v-on="
																									inputEvents
																								"
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
                                        class="text-sm font-medium leading-4 text-gray-700 dark:text-gray-300"
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
                                        class="focus:border-primary-600 focus:ring-primary-600 dark:focus:border-primary-600 block w-full rounded-lg border-gray-300 text-gray-900 shadow-sm transition duration-75 focus:ring-1 focus:ring-inset disabled:opacity-70 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
					<div class="w-full max-w-md grow px-4">
						<TabGroup :selected-index="selectedTab" @change="changeTab">
							<TabList class="flex space-x-1 rounded-lg bg-blue-900/20 p-1">
								<AppTab
									v-for="category in Object.keys(categories)"
									:key="category"
									v-slot="{ selected }"
									as="template"
								>
									<button
										:class="[
											'w-full rounded-md px-3 py-2 text-sm leading-5 font-medium',
											'ring-opacity-60 ring-white ring-offset-2 ring-offset-blue-400 focus:outline-none focus-visible:ring-2',
											selected
												? 'bg-white text-blue-700 shadow'
												: 'text-blue-50 hover:bg-white/12 hover:text-white',
										]"
									>
										{{ category }}
									</button>
								</AppTab>
							</TabList>
						</TabGroup>
					</div>
				</div>
			</div>
		</header>
		<div id="head" class="container mx-auto max-w-5xl px-4 py-6 sm:px-2">
			<div class="grid grid-cols-3 gap-6">
				<div>
					<ul
						ref="groupHeaders"
						role="list"
						class="space-y-6 pl-2 text-sm leading-6 text-slate-700 lg:sticky lg:top-0 lg:-mt-16 lg:h-screen lg:w-72 lg:overflow-y-auto lg:mask-[linear-gradient(to_bottom,transparent,white_4rem,white)] lg:py-16 lg:pr-8"
					>
						<li>
							<div class="rounded-lg bg-white shadow-md">
								<div class="flex gap-2 px-4 py-4 md:px-6">
									<AppBtn>{{ totalTabs }} </AppBtn>
									<AppBtn @click="closeDuplicates"> Close duplicates </AppBtn>
								</div>
							</div>
						</li>
						<li v-for="(group, index) in grouped" :key="`list-${index}`">
							<Disclosure v-slot="{ open }">
								<DisclosureButton
									class="focus-visible:ring-opacity-75 flex w-full items-center justify-between space-x-2 rounded-lg bg-blue-100 px-4 py-2 text-left text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring focus-visible:ring-blue-500"
								>
									<router-link
										:to="{ name: 'index', hash: `#section-${index}` }"
										class="inline-flex w-full justify-between font-semibold text-slate-900"
									>
										<div>{{ index }}</div>
										<div
											class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm"
										>
											{{ group.length }}
										</div>
									</router-link>
									<ChevronUpIcon
										:class="open ? 'rotate-180 transform' : ''"
										class="h-5 w-5 text-blue-500"
									/>
								</DisclosureButton>
								<DisclosurePanel class="px-4 text-sm text-slate-500">
									<ul
										role="list"
										class="mt-2 space-y-4 border-l border-slate-200 pl-6"
									>
										<li>
											<button @click="moveTabs(group)">
												Move to new window
											</button>
										</li>
										<li>
											<button @click="closeTabs(group)">Close all</button>
										</li>
										<li>
											<button @click="copyLinks(group)">
												Copy all links
											</button>
										</li>
									</ul>
								</DisclosurePanel>
							</Disclosure>
						</li>
					</ul>
				</div>
				<div ref="groupContainer" class="col-span-2 space-y-6">
					<div
						v-for="(group, index) in grouped"
						:id="`section-${index}`"
						:key="`section-${index}`"
						class="divide-y divide-slate-100 rounded-lg bg-white shadow-md"
					>
						<div class="px-4 py-4 md:px-6">
							<h2 class="sr-only">{{ index }}</h2>
							<div class="flex items-center justify-between">
								<AppBtn>
									{{ index }}
								</AppBtn>
								<div class="flex items-center space-x-2">
									<AppBtn type="button" @click="selectGroup(group)">
										Select
									</AppBtn>
									<AppBtn type="button" @click="moveTabs(group)"> Move </AppBtn>
									<AppBtn type="button" @click="copyLinks(group)"> Copy </AppBtn>
									<AppBtn
										type="button"
										color="round-primary"
										@click="closeTabs(group)"
									>
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
					</div>
				</div>
			</div>
		</div>
		<footer
			v-if="[...tabsSelected].length > 0"
			class="sticky right-0 bottom-0 left-0 z-10 w-full bg-slate-900 shadow-lg"
		>
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-2">
				<div
					class="flex w-full items-center justify-between rounded-lg px-4 py-4 text-lg md:px-6"
				>
					<div class="text-slate-300">{{ [...tabsSelected].length }} Tabs selected</div>
					<div class="flex items-center space-x-2">
						<AppBtn
							type="button"
							color="primary-dark"
							@click="closeTabs(selectedGroup)"
						>
							Close all
						</AppBtn>
						<Menu as="div" class="pointer-events-auto relative inline-flex text-left">
							<MenuButton as="template">
								<AppBtn color="primary-dark">
									Move to
									<ChevronDownIcon
										class="-mr-1 ml-2 h-3 w-3 text-slate-200"
										aria-hidden="true"
									/>
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
									class="ring-opacity-5 absolute right-0 bottom-0 z-10 mt-2 w-56 origin-bottom-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black focus:outline-none"
								>
									<div class="px-1 py-1">
										<MenuItem
											v-for="[windowId, value] in [...windowsMap]"
											v-slot="{ active, disabled }"
											:key="`${windowId}-custom-selected`"
											@click="
												moveTabTo(selectedGroup, {
													containerId: windowId,
													type: 'window_container',
												})
											"
										>
											<button
												:class="[
													active
														? 'bg-blue-500 text-white'
														: 'text-slate-700',
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
											v-for="loadedGroup in loadedGroups"
											v-slot="{ active, disabled }"
											:key="`${loadedGroup.id}-custom-selected`"
											@click="
												moveTabTo(selectedGroup, {
													containerId: loadedGroup.id,
													type: 'group_container',
												})
											"
										>
											<button
												:class="[
													active
														? 'bg-blue-500 text-white'
														: 'text-slate-700',
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
						<AppBtn color="primary-dark" type="button" @click="moveTabs(selectedGroup)">
							Move
						</AppBtn>
						<AppBtn
							color="primary-dark"
							type="button"
							@click="storeSession(selectedGroup)"
						>
							Save as session
						</AppBtn>
						<AppBtn
							color="primary-dark"
							type="button"
							@click="copyLinks(selectedGroup)"
						>
							Copy
						</AppBtn>
						<AppBtn
							color="round-dark-primary"
							type="button"
							@click="tabsSelected.clear()"
						>
							<XMarkIcon class="h-3 w-3" />
						</AppBtn>
					</div>
				</div>
			</div>
		</footer>
	</div>
</template>
