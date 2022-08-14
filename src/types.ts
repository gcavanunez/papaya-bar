export type ChromeTab = chrome.tabs.Tab
export type Tab = chrome.tabs.Tab & { stableId: string }
export type HistoryMap = Map<string, chrome.history.VisitItem[]>
export type Group = chrome.tabGroups.TabGroup
export type Grouped = Record<string, Tab[]>
