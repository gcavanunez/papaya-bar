import { ChromeTab, Group, HistoryMap, Tab } from '@/types'
import { onMounted, ref } from 'vue'

export const useChromeTabs = () => {
	const loadedTabs = ref<Tab[]>([])
	const loadedTabHistory = ref<HistoryMap>(new Map())
	const lookUpTab = ref<Record<string, chrome.history.VisitItem[]>>({})
	const loadedGroups = ref<Group[]>([])
	const loadedCurrentWindowId = ref<number>()

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
		let count = Object.values(Object.fromEntries(loadedTabHistory.value.entries())).reduce(
			(acc, curr) => acc + curr.length,
			0
		)
		console.log(count)

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
	onMounted(() => {
		// To be able to load in dev environment
		if (chrome.tabs) {
			console.log('---initing---')
			init()
			chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
				console.log('---onUpdated---')
				// init()
			})
			chrome.tabs.onRemoved.addListener((tab, removeInfo) => {
				console.log('---onRemoved---')
				init()
			})
			chrome.tabs.onMoved.addListener((tabId) => {
				console.log('---onMoved---')
				init()
			})
			chrome.tabs.onAttached.addListener((tabId) => {
				console.log('---onAttached---')
				init()
			})
		}
	})

	return { loadedTabs, loadedGroups, loadedTabHistory, lookUpTab }
}
