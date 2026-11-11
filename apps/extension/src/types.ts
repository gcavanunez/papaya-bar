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
	pinned?: boolean
	audible?: boolean
}
export type Tab = SaveableTab & {
	lastestHistory?: chrome.history.VisitItem
}
export type HistoryMap = Map<string, chrome.history.VisitItem[]>
export type Group = chrome.tabGroups.TabGroup
export type Grouped = Record<string, Tab[]>
export type TabGroupBy = 'site' | 'group' | 'window' | 'date'
/** A labelled bucket of tabs shown under one header in the tab manager */
export type TabSection = {
	key: string
	label: string
	tabs: Tab[]
	/** The catch-all bucket ("Other sites", "Ungrouped", …) */
	isOther?: boolean
	/** Chrome tab-group id when grouping by tab group */
	groupId?: number
	/** Hex swatch for tab groups */
	color?: string
	/** Representative favicon + URL for site sections */
	favIconUrl?: string
	url?: string
}
export type LookUpTab = Record<string, chrome.history.VisitItem[]>
export type WindowsMap = Map<number, string>

/** Window bounds as saved with a session */
export type SavedWindow = {
	width?: number
	left?: number
	height?: number
	top?: number
	id?: number
}
export type SavedDisplay = {
	height: number
	left: number
	top: number
	width: number
}
