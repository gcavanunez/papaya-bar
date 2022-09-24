import { ChromeTab, Group, HistoryMap, LookUpTab, Tab, WindowsMap } from '@/types'

import { computed, onMounted, onUnmounted, ref } from 'vue'

const loadedTabs = ref<Tab[]>([])
const loadedTabHistory = ref<HistoryMap>(new Map())
const lookUpTab = ref<LookUpTab>({})
const loadedGroups = ref<Group[]>([])
const loadedCurrentWindowId = ref<number>()

export const useChromeTabs = () => {
	const windowsMap = computed<WindowsMap>(() => {
		const computedSet = new Set<number>()
		const windowsSet = new Map<number, string>()

		loadedTabs.value.forEach((row) => {
			computedSet.add(row.windowId)
		})

		const arr = [...computedSet]
		arr.forEach((item, index) => {
			const current = loadedCurrentWindowId.value == item ? ' (Current)' : ''
			windowsSet.set(item, `Window ${index + 1}${current}`)
		})

		return windowsSet
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
		let tabHistoryPromises: Promise<chrome.history.VisitItem[]>[] = []
		let tabIndexes: string[] = []
		let lilRecord: Record<string, chrome.history.VisitItem[]> = {}
		tabs.forEach((row) => {
			if (row.url) {
				tabIndexes.push(row.url)
				tabHistoryPromises.push(chrome.history.getVisits({ url: row.url }))
			}
		})
		const results = await Promise.all(tabHistoryPromises)
		results.forEach((row, index) => {
			lilRecord[tabIndexes[index]] = row
		})
		loadedTabHistory.value = new Map(Object.entries(lilRecord))
		lookUpTab.value = lilRecord
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
		}
		onUnmounted(() => {
			if (chrome.tabs) {
				console.log('---killing---')
				chrome.tabs.onUpdated.removeListener(fire)
				chrome.tabs.onRemoved.removeListener(fire)
				chrome.tabs.onMoved.removeListener(fire)
				chrome.tabs.onAttached.removeListener(fire)
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
