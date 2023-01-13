import { getTabHistory } from '@/helpers'
import { ChromeTab, Group, HistoryMap, LookUpTab, Tab, WindowsMap } from '@/types'

import { computed, onMounted, onUnmounted, ref } from 'vue'
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
	const fire = () => {
		init()
	}
	// this whole portion needs to be refactored to also removeListener
	const initlisteners = () => {
		if (chrome.tabs) {
			console.log('---initing---')
			fire()
			chrome.tabs.onUpdated.addListener(fire)
			chrome.tabs.onRemoved.addListener(fire)
			chrome.tabs.onMoved.addListener(fire)
			chrome.tabs.onAttached.addListener(fire)
			chrome.tabGroups.onCreated.addListener(fire)
			chrome.tabGroups.onMoved.addListener(fire)
			chrome.tabGroups.onRemoved.addListener(fire)
			chrome.tabGroups.onUpdated.addListener(fire)
		}
		onUnmounted(() => {
			if (chrome.tabs) {
				console.log('---killing---')
				chrome.tabs.onUpdated.removeListener(fire)
				chrome.tabs.onRemoved.removeListener(fire)
				chrome.tabs.onMoved.removeListener(fire)
				chrome.tabs.onAttached.removeListener(fire)
				chrome.tabGroups.onCreated.removeListener(fire)
				chrome.tabGroups.onMoved.removeListener(fire)
				chrome.tabGroups.onRemoved.removeListener(fire)
				chrome.tabGroups.onUpdated.removeListener(fire)
			}
		})
	}

	// implicit approach
	// const fire = () => {
	// 	init()
	// }
	// onMounted(() => {
	// 	if (chrome.tabs) {
	// 		console.log('---initing---')
	// 		chrome.tabs.onUpdated.addListener(fire)
	// 		chrome.tabs.onRemoved.addListener(fire)
	// 		chrome.tabs.onMoved.addListener(fire)
	// 		chrome.tabs.onAttached.addListener(fire)
	// 	}
	// })
	// onUnmounted(() => {
	// 	if (chrome.tabs) {
	// 		console.log('---killing---')
	// 		chrome.tabs.onUpdated.removeListener(fire)
	// 		chrome.tabs.onRemoved.removeListener(fire)
	// 		chrome.tabs.onMoved.removeListener(fire)
	// 		chrome.tabs.onAttached.removeListener(fire)
	// 	}
	// })
	// })

	return { loadedTabs, loadedGroups, loadedTabHistory, lookUpTab, windowsMap, initlisteners }
}
