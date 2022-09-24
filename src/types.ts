export type ChromeTab = chrome.tabs.Tab
export type ChromeGroup = chrome.tabGroups.TabGroup
// export type Tab = chrome.tabs.Tab & { stableId: string; lastestHistory?: chrome.history.VisitItem }

export type SaveableTab = {
	windowId: number
	stableId: string
	url?: string
	title?: string
	favIconUrl?: string
	id?: number
	active: boolean
	groupId?: number
}
export type Tab = SaveableTab & {
	lastestHistory?: chrome.history.VisitItem
}
export type HistoryMap = Map<string, chrome.history.VisitItem[]>
export type Group = chrome.tabGroups.TabGroup
export type Grouped = Record<string, Tab[]>
export type LookUpTab = Record<string, chrome.history.VisitItem[]>
export type WindowsMap = Map<number, string>
