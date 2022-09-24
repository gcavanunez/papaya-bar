import { Tab } from './types'
import { copyToClipboard } from './utils'

type moveToTypes = 'window_container' | 'group_container'

export const moveTabTo = (
	tabs: Tab[],
	{ containerId, type }: { containerId: number; type: moveToTypes }
) => {
	if (type === 'window_container') {
		tabs.forEach((row) => {
			if (row.id) {
				chrome.tabs.move(row.id, {
					index: -1,
					// windowId
					windowId: containerId,
				})
			}
		})
	}
	if (type === 'group_container') {
		chrome.tabs.group({
			groupId: containerId,
			tabIds: tabs.filter((row) => row.id).map((row) => row.id!),
		})
		// chrome.tabGroups.move()
	}
}

export const copyLink = (tab: Tab) => {
	const text = `${tab.title}\n${tab.url}`
	copyToClipboard(text)
}

export const closeTab = (tab: Tab) => {
	if (tab.id) {
		chrome.tabs.remove(tab.id)
	}
}

export const goTo = (tab: Tab) => {
	if (tab.id) {
		chrome.windows.update(tab.windowId, { focused: true })
		chrome.tabs.update(tab.id, { active: true })
		// chrome.tabs.get(tab.id, function (onTab) {
		//   chrome.tabs.highlight({ tabs: onTab.index }, function () {})
		// })
	}
}
export const moveTabs = async (tabs: Tab[]) => {
	const newWindow = await chrome.windows.create({
		url: tabs[0].url,
	})
	tabs.forEach((row, index) => {
		if (index === 0) {
			return
		}
		if (row.id) {
			chrome.tabs.move(row.id, {
				index: -1,
				windowId: newWindow.id,
			})
		}
	})
}
