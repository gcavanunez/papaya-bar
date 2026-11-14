/**
 * liveTabs — which open tabs Papaya may save or close.
 *
 * Framework-free, so pages and the background worker share it. Pinned tabs and
 * Papaya's own pages are never touched.
 */

type ChromeTab = chrome.tabs.Tab

/** True for the extension's own pages (manager, side panel) */
export function isOwnPage(tab: ChromeTab): boolean {
	const prefix = `chrome-extension://${chrome.runtime.id}`
	return (tab.url || '').startsWith(prefix) || (tab.pendingUrl || '').startsWith(prefix)
}

/** IDs of the tabs a session switch closes: everything but pinned tabs and Papaya's pages */
export async function getCloseableTabIds(): Promise<number[]> {
	const tabs = await chrome.tabs.query({})
	return tabs.filter((t) => t.id != null && !isOwnPage(t) && !t.pinned).map((t) => t.id as number)
}
