import { getTabHistory } from '@/helpers'
import { ChromeTab, Group, HistoryMap, LookUpTab, Tab } from '@/types'

import { onUnmounted, ref } from 'vue'
import { useChromeWindowsMap } from './useChromeWindowsMap'

const loadedTabs = ref<Tab[]>([])
const loadedTabHistory = ref<HistoryMap>(new Map())
const lookUpTab = ref<LookUpTab>({})
const loadedGroups = ref<Group[]>([])
const loadedCurrentWindowId = ref<number>()

export const useChromeTabs = () => {
	const windowsMap = useChromeWindowsMap({
		loadedTabs,
		loadedCurrentWindowId: loadedCurrentWindowId.value,
	})

	const init = async () => {
		const [tabs, currentWindowId, groups] = await Promise.all([
			new Promise<ChromeTab[]>((resolve) => {
				chrome.tabs.query({}, (tabs) => resolve(tabs))
			}),
			new Promise<number | undefined>((resolve) => {
				chrome.windows.getCurrent({}, ({ id }) => resolve(id))
			}),
			new Promise<Group[]>((resolve) => {
				chrome.tabGroups.query({}, (group) => resolve(group))
			}),
		])
		console.log(tabs.length, currentWindowId, groups.length)
		loadedCurrentWindowId.value = currentWindowId

		loadedTabs.value = tabs.map((row) => ({
			...row,
			stableId: `stableId-${row.id}`,
		}))

		const { loadedTabHistory: loadedTabHistoryValues, lookUpTab: lookUpTabValues } =
			await getTabHistory(loadedTabs.value)
		loadedTabHistory.value = loadedTabHistoryValues
		lookUpTab.value = lookUpTabValues

		// let count = Object.values(Object.fromEntries(loadedTabHistory.value.entries())).reduce(
		// 	(acc, curr) => acc + curr.length,
		// 	0
		// )

		// tabs.forEach((row) => {
		// 	if (row.url) {
		// 		chrome.history.getVisits({ url: row.url }).then((tabHistory) => {
		// 			// console.log('---visit run---')
		// 			console.log('---visit run---:', row.url)
		// 			console.log('---tab count---:', tabHistory.length)
		// 			loadedTabHistory.value.set(row.url!, tabHistory)

		// 			let count = Object.values(Object.fromEntries(loadedTabHistory.value.entries())).reduce(
		// 				(acc, curr) => acc + curr.length,
		// 				0
		// 			)
		// 			console.log(count)
		// 			// loadedTabs.value = loadedTabs.value.map((row) => {
		// 			// 	return {
		// 			// 		...row,
		// 			// 		lastestHistory: [...tabHistory][0],
		// 			// 	}
		// 			// })
		// 		})
		// 		// tabHistoryPromises.push()
		// 		// loadedTabHistory.value.set(row.url, [])
		// 	}
		// })

		// const tabHistoryResults = await Promise.all(tabHistoryPromises)
		// tabHistoryResults.forEach((tabHistory) => {
		//   tabHistory
		// })
		loadedGroups.value = groups
	}
	// onMounted(() => {
	// To be able to load in dev environment
	const fire = (listener: string) => {
		console.log(listener)
		init()
	}
	// this whole portion needs to be refactored to also removeListener
	const initlisteners = () => {
		if (chrome.tabs) {
			console.log('---initing---')
			fire('first run')
			chrome.tabs.onUpdated.addListener(() => fire('tabs.onUpdated'))
			chrome.tabs.onRemoved.addListener(() => fire('tabs.onRemoved'))
			chrome.tabs.onMoved.addListener(() => fire('tabs.onMoved'))
			chrome.tabs.onAttached.addListener(() => fire('tabs.onAttached'))
			chrome.tabGroups.onCreated.addListener(() => fire('tabGroups.onCreated'))
			chrome.tabGroups.onMoved.addListener(() => fire('tabGroups.onMoved'))
			chrome.tabGroups.onRemoved.addListener(() => fire('tabGroups.onRemoved'))
			chrome.tabGroups.onUpdated.addListener(() => fire('tabGroups.onUpdated'))
		}
		onUnmounted(() => {
			if (chrome.tabs) {
				console.log('---killing---')
				chrome.tabs.onUpdated.removeListener(() => fire('tabs.onUpdated'))
				chrome.tabs.onRemoved.removeListener(() => fire('tabs.onRemoved'))
				chrome.tabs.onMoved.removeListener(() => fire('tabs.onMoved'))
				chrome.tabs.onAttached.removeListener(() => fire('tabs.onAttached'))
				chrome.tabGroups.onCreated.removeListener(() => fire('tabGroups.onCreated'))
				chrome.tabGroups.onMoved.removeListener(() => fire('tabGroups.onMoved'))
				chrome.tabGroups.onRemoved.removeListener(() => fire('tabGroups.onRemoved'))
				chrome.tabGroups.onUpdated.removeListener(() => fire('tabGroups.onUpdated'))
			}
		})
	}

	return {
		loadedTabs,
		loadedGroups,
		loadedTabHistory,
		lookUpTab,
		windowsMap,
		initlisteners,
	}
}
