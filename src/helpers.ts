import { Tab, LookUpTab, SaveableTab } from './types'
import { copyToClipboard } from './utils'

type moveToTypes = 'window_container' | 'group_container'

export const getTabHistory = async (tabs: SaveableTab[]) => {
	const tabHistoryPromises: Promise<chrome.history.VisitItem[]>[] = []
	const tabIndexes: string[] = []
	const lilRecord: LookUpTab = {}
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
	const loadedTabHistory = new Map(Object.entries(lilRecord))
	const lookUpTab = lilRecord
	return {
		loadedTabHistory,
		lookUpTab,
	}
}

export const moveTabTo = (
	tabs: Tab[],
	{ containerId, type }: { containerId: number; type: moveToTypes },
) => {
	if (type === 'window_container') {
		tabs.forEach((row) => {
			if (row.id) {
				chrome.tabs.move(row.id, {
					index: -1,
					windowId: containerId,
				})
			}
		})
	}
	if (type === 'group_container') {
		chrome.tabs.group({
			groupId: containerId,
			tabIds: tabs.filter((row) => row.id).map((row) => row.id!) as [number, ...number[]],
		})
	}
}

export const copyLink = (tab: Pick<Tab, 'title' | 'url'>) => {
	const text = `${tab.title}\n${tab.url}`
	copyToClipboard(text)
}

export const closeTab = (tabs: Tab[]) => {
	const ids: number[] = []
	for (const tab of tabs) {
		if (tab.id) {
			ids.push(tab.id)
		}
	}
	chrome.tabs.remove(ids)
}

export const goTo = (tab: Tab) => {
	chrome.tabs.query({}, function(tabs) {
		if (tabs.length) {
			if (tab.id && tabs.find((row) => row.id == tab.id)) {
				chrome.windows.update(tab.windowId, { focused: true })
				chrome.tabs.update(tab.id, { active: true })
				return
			}
		}
		chrome.tabs.create({ url: tab.url })
	})
}
export const moveTabs = async (tabs: Tab[]) => {
	const newWindow = await chrome.windows.create({})
	if (!newWindow) return
	const newTab = newWindow.tabs
	tabs.forEach((row) => {
		if (row.id) {
			chrome.tabs.move(row.id, {
				index: -1,
				windowId: newWindow.id,
			})
		}
	})
	if (newTab?.length) {
		closeTab(newTab.map((row) => ({ ...row, stableId: 'new-tab' })))
	}
}
export const closeDuplicates = (loadedTabs: Tab[]) => {
	const duplicates = loadedTabs.filter(
		(item, index, allTabs) => allTabs.findIndex((withIn) => withIn.url === item.url) != index,
	)
	closeTab(duplicates)
}
