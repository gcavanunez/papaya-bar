/**
 * useOpenGroups — Chrome's tab groups and the loose tabs around them, kept live
 * while the page is open.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildOpenGroups, isLooseTab, type OpenGroup } from '@/lib/tabGroups'

export function useOpenGroups() {
	const groups = ref<OpenGroup[]>([])
	const looseTabs = ref<chrome.tabs.Tab[]>([])
	const focusedWindowId = ref<number | null>(null)

	async function refresh(): Promise<void> {
		const [tabGroups, tabs, focused] = await Promise.all([
			chrome.tabGroups.query({}),
			// Only normal windows can hold tab groups
			chrome.tabs.query({ windowType: 'normal' }),
			chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null),
		])
		groups.value = buildOpenGroups(tabGroups, tabs)
		looseTabs.value = tabs.filter(isLooseTab)
		focusedWindowId.value = focused?.id ?? null
	}

	/** The group holding the active tab of the window you're in. */
	const focusedGroupId = computed(
		() =>
			groups.value.find((g) => g.hasActiveTab && g.windowId === focusedWindowId.value)?.id ??
			null,
	)

	/** 1-based window numbers, for telling groups apart when several windows have them. */
	const windowNumbers = computed(() => {
		const ids = [...new Set(groups.value.map((g) => g.windowId))]
		return ids.length > 1 ? new Map(ids.map((id, i) => [id, i + 1])) : null
	})

	// Loading pages fire many tab updates; coalesce them
	let timer: ReturnType<typeof setTimeout> | undefined
	function scheduleRefresh(): void {
		clearTimeout(timer)
		timer = setTimeout(() => void refresh(), 150)
	}

	const events = [
		chrome.tabGroups.onCreated,
		chrome.tabGroups.onUpdated,
		chrome.tabGroups.onRemoved,
		chrome.tabGroups.onMoved,
		chrome.tabs.onCreated,
		chrome.tabs.onRemoved,
		chrome.tabs.onUpdated,
		chrome.tabs.onActivated,
		chrome.tabs.onMoved,
		chrome.tabs.onAttached,
		chrome.tabs.onDetached,
		chrome.windows.onFocusChanged,
	] as chrome.events.Event<() => void>[]

	onMounted(() => {
		void refresh()
		events.forEach((event) => event.addListener(scheduleRefresh))
	})
	onUnmounted(() => {
		clearTimeout(timer)
		events.forEach((event) => event.removeListener(scheduleRefresh))
	})

	return { groups, looseTabs, focusedGroupId, windowNumbers, refresh }
}
