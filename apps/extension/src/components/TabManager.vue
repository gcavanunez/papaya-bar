<script setup lang="ts">
import {
	ArchiveBoxArrowDownIcon,
	ArrowsPointingInIcon,
	ArrowsPointingOutIcon,
	ArrowsRightLeftIcon,
	BookmarkIcon,
	CalendarDaysIcon,
	ClockIcon,
	DocumentDuplicateIcon,
	EllipsisHorizontalIcon,
	FunnelIcon,
	GlobeAltIcon,
	ListBulletIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	RectangleStackIcon,
	Square2StackIcon,
	Squares2X2Icon,
	TagIcon,
	TrashIcon,
	WindowIcon,
	XMarkIcon,
} from '@heroicons/vue/16/solid'
import {
	computed,
	nextTick,
	onMounted,
	reactive,
	ref,
	watch,
	type Component,
	type ComponentPublicInstance,
} from 'vue'
import { Popover, PopoverButton, PopoverPanel, Menu, MenuButton } from '@headlessui/vue'
import {
	useActiveElement,
	useEventListener,
	useMediaQuery,
	useResizeObserver,
	useWindowScroll,
} from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useWindowVirtualizer } from '@tanstack/vue-virtual'
import { isAfter, isBefore, isWithinInterval, sub } from 'date-fns'

import { copyToClipboard, formatTabAsMarkdown } from '../utils'
import { closeTab, closeDuplicates, goTo, moveTabs, pinTabs, undoCloseTabs } from '@/helpers'
import { getHostname, isOwnExtensionUrl, pluralize, recencyBucket } from '@/lib/format'
import { button } from '@/lib/ui'
import { browserReservedCtrlKeys, isMac, paletteShortcutLabel } from '@/lib/platform'
import type { Group, HistoryMap, LookUpTab, Tab, TabGroupBy, TabSection, WindowsMap } from '@/types'
import { useSettings } from '@/hooks/useSettings'
import { useSessionsData } from '@/hooks/useSessionsData'
import { tabGroupHex, useGlobalModals } from '@/hooks/useGlobalModals'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import { useContexts } from '@/hooks/useContexts'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useKeymap, type CtrlLayer, type KeyBinding, type KeymapMode } from '@/hooks/useKeymap'
import AppButton from '@/components/AppButton.vue'
import AppMenuItems from '@/components/menu/AppMenuItems.vue'
import AppMenuItem from '@/components/menu/AppMenuItem.vue'
import AppSwitch from '@/components/forms/AppSwitch.vue'
import SearchInput from '@/components/forms/SearchInput.vue'
import SegmentedControl from '@/components/forms/SegmentedControl.vue'
import EmptyState from '@/components/EmptyState.vue'
import TabRow from '@/components/TabRow.vue'
import TabListItem from '@/components/TabListItem.vue'
import TabSectionHeader from '@/components/TabSectionHeader.vue'
import TabMoveToMenu from '@/components/TabMoveToMenu.vue'
import TabManagerStatusline from '@/components/TabManagerStatusline.vue'
import KeymapHelpOverlay from '@/components/KeymapHelpOverlay.vue'

const { triggerConfirm } = useGlobalConfirm()
const { onEditGroup, onCreateNewGroup } = useGlobalModals()
const { storeSession } = useSessionsData()
const { settings, loadSettings } = useSettings()
const { contexts, peelOff } = useContexts()
const { open: openPalette } = useCommandPalette()

// Contexts available as peel-off targets (everything not archived).
const peelTargets = computed(() => contexts.value.filter((c) => c.status !== 'archived'))

async function stashSelectedTo(contextId: string) {
	await peelOff(selectedGroup.value, { contextId })
	tabsSelected.value.clear()
}
async function stashSelectedToNew() {
	const name = window.prompt('Name the new context')
	if (!name?.trim()) return
	await peelOff(selectedGroup.value, { name: name.trim() })
	tabsSelected.value.clear()
}

const ranges: Record<string, { value: string; label: string; is_range: boolean }> = {
	'<>': {
		value: '<>',
		label: 'Between',
		is_range: true,
	},
	'=': {
		value: '=',
		label: 'On day',
		is_range: false,
	},
	'<': {
		value: '<',
		label: 'Before',
		is_range: false,
	},
	'>': {
		value: '>',
		label: 'After',
		is_range: false,
	},
}
const rangeOptions = Object.values(ranges).map(({ value, label }) => ({ value, label }))

type PinnedFilter = 'any' | 'pinned' | 'unpinned'
type GroupingFilter = 'any' | 'grouped' | 'ungrouped'

const filter = reactive({
	has_date_range: false,
	date_range_type: ranges['<>'].value,
	date: new Date(),
	range: {
		start: sub(new Date(), { days: 1 }),
		end: new Date(),
	},
	pinned: 'any' as PinnedFilter,
	grouping: 'any' as GroupingFilter,
	audible: false,
	duplicatesOnly: false,
})

const pinnedOptions: { value: PinnedFilter; label: string }[] = [
	{ value: 'any', label: 'Any' },
	{ value: 'pinned', label: 'Pinned' },
	{ value: 'unpinned', label: 'Not pinned' },
]
const groupingOptions: { value: GroupingFilter; label: string }[] = [
	{ value: 'any', label: 'Any' },
	{ value: 'grouped', label: 'In a group' },
	{ value: 'ungrouped', label: 'Ungrouped' },
]

// Quick "last visited" presets; 'custom' reveals the full range controls.
const datePresets = [
	{ label: 'Last hour', duration: { hours: 1 } },
	{ label: 'Last 24h', duration: { days: 1 } },
	{ label: 'Last 7 days', duration: { days: 7 } },
	{ label: 'Last 30 days', duration: { days: 30 } },
]
const activeDatePreset = ref<string>('custom')
const applyDatePreset = (preset: (typeof datePresets)[number]) => {
	filter.has_date_range = true
	filter.date_range_type = ranges['<>'].value
	filter.range = { start: sub(new Date(), preset.duration), end: new Date() }
	activeDatePreset.value = preset.label
}
const presetPillClass = (active: boolean) => [
	'h-6 rounded-full px-2.5 text-xs font-medium transition-colors',
	active
		? 'bg-slate-900 text-white dark:bg-white dark:text-black'
		: 'dark:bg-vercel-accents-2 dark:text-vercel-accents-6 dark:hover:bg-vercel-accents-3 bg-slate-100 text-slate-600 hover:bg-slate-200',
]

const activeFilterCount = computed(() => {
	let count = 0
	if (filter.has_date_range) count++
	if (filter.pinned !== 'any') count++
	if (filter.grouping !== 'any') count++
	if (filter.audible) count++
	if (filter.duplicatesOnly) count++
	return count
})

const clearFilters = () => {
	filter.has_date_range = false
	filter.pinned = 'any'
	filter.grouping = 'any'
	filter.audible = false
	filter.duplicatesOnly = false
	activeDatePreset.value = 'custom'
}

// Removable chips so it's always obvious why tabs are hidden
const activeFilterChips = computed(() => {
	const chips: { key: string; label: string; clear: () => void }[] = []
	if (filter.has_date_range) {
		chips.push({
			key: 'date',
			label:
				activeDatePreset.value === 'custom'
					? 'Visited in custom range'
					: `Visited ${activeDatePreset.value.toLowerCase()}`,
			clear: () => {
				filter.has_date_range = false
				activeDatePreset.value = 'custom'
			},
		})
	}
	if (filter.pinned !== 'any') {
		chips.push({
			key: 'pinned',
			label: filter.pinned === 'pinned' ? 'Pinned' : 'Not pinned',
			clear: () => (filter.pinned = 'any'),
		})
	}
	if (filter.grouping !== 'any') {
		chips.push({
			key: 'grouping',
			label: filter.grouping === 'grouped' ? 'In a tab group' : 'Not in a tab group',
			clear: () => (filter.grouping = 'any'),
		})
	}
	if (filter.audible) {
		chips.push({
			key: 'audible',
			label: 'Playing audio',
			clear: () => (filter.audible = false),
		})
	}
	if (filter.duplicatesOnly) {
		chips.push({
			key: 'duplicates',
			label: 'Duplicates',
			clear: () => (filter.duplicatesOnly = false),
		})
	}
	return chips
})

const masks = {
	input: 'YYYY-MM-DD h:mm A',
}
const searchInput = ref<InstanceType<typeof SearchInput> | null>(null)
const inputRef = computed<HTMLInputElement | null>(() => searchInput.value?.input ?? null)
const isListView = ref(true)
const cursorIndex = ref(0)
const helpOpen = ref(false)

type ViewMode = 'list' | 'grid'
const viewMode = computed<ViewMode>({
	get: () => (isListView.value ? 'list' : 'grid'),
	set: (mode) => (isListView.value = mode === 'list'),
})
const viewOptions: { value: ViewMode; label: string; icon: Component; title: string }[] = [
	{ value: 'list', label: 'List', icon: ListBulletIcon, title: 'List view (t)' },
	{ value: 'grid', label: 'Grid', icon: Squares2X2Icon, title: 'Grid view (t)' },
]

const focusOnInput = () => {
	searchInput.value?.focus()
}

const goToTab = (tab: Tab) => {
	if (typeof chrome !== 'undefined') goTo(tab)
}

const searchTerm = ref<string>('')
const tabsSelected = ref<Set<string>>(new Set())

const groupByOptions: { value: TabGroupBy; label: string; icon: Component; title: string }[] = [
	{ value: 'site', label: 'Site', icon: GlobeAltIcon, title: 'Group by site (h / l)' },
	{ value: 'group', label: 'Tab group', icon: TagIcon, title: 'Group by tab group (h / l)' },
	{ value: 'window', label: 'Window', icon: WindowIcon, title: 'Group by window (h / l)' },
	{ value: 'date', label: 'Last visit', icon: ClockIcon, title: 'Group by last visit (h / l)' },
]
const groupBy = ref<TabGroupBy>('site')
const groupByLabel = computed(
	() => groupByOptions.find((option) => option.value === groupBy.value)?.label ?? 'Site',
)
const isWide = useMediaQuery('(min-width: 1024px)')

type Props = {
	loadedTabs: Tab[]
	loadedGroups: Group[]
	loadedTabHistory: HistoryMap
	lookUpTab: LookUpTab
	windowsMap: WindowsMap
}
const props = defineProps<Props>()

const groupById = computed(() => new Map(props.loadedGroups.map((group) => [group.id, group])))

// Everything except this extension's own pages (the manager itself, the side panel…)
const managedTabs = computed(() => props.loadedTabs.filter((tab) => !isOwnExtensionUrl(tab.url)))

const selectedGroup = computed(() => {
	return props.loadedTabs.filter((row) => tabsSelected.value.has(row.stableId))
})

const historySet = computed(() => {
	const checkSet = new Set<string>()
	for (const [key, value] of props.loadedTabHistory) {
		const bool = value.some((row) => {
			if (filter.date_range_type === ranges['<>'].value) {
				return isWithinInterval(row.visitTime!, {
					end: filter.range.end,
					start: filter.range.start,
				})
			}
			if (filter.date_range_type == ranges['<'].value) {
				return isBefore(row.visitTime!, filter.date)
			}
			if (filter.date_range_type == ranges['>'].value) {
				return isAfter(row.visitTime!, filter.date)
			}
			return isWithinInterval(row.visitTime!, {
				end: filter.date,
				start: sub(filter.date, { days: 1 }),
			})
		})
		if (bool) {
			checkSet.add(key)
		}
	}
	return checkSet
})
// URLs that appear more than once across all loaded tabs
const duplicateUrls = computed(() => {
	const seen = new Map<string, number>()
	for (const tab of props.loadedTabs) {
		if (tab.url) seen.set(tab.url, (seen.get(tab.url) ?? 0) + 1)
	}
	return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([url]) => url))
})
// How many tabs "Close duplicates" would close
const duplicateExtraCount = computed(() => {
	const seen = new Set<string>()
	let extra = 0
	for (const tab of managedTabs.value) {
		if (!tab.url) continue
		if (seen.has(tab.url)) extra++
		else seen.add(tab.url)
	}
	return extra
})

// ---------------------------------------------------------------------------
// Filtering + grouping
// ---------------------------------------------------------------------------
const visibleTabs = computed(() => {
	const term = searchTerm.value.toLocaleLowerCase()
	return managedTabs.value.filter((row) => {
		if (!row.title || !row.url) {
			return false
		}
		if (filter.has_date_range && !historySet.value.has(row.url)) {
			return false
		}
		if (filter.pinned !== 'any' && (filter.pinned === 'pinned') !== !!row.pinned) {
			return false
		}
		const inGroup = !!row.groupId && row.groupId !== -1
		if (filter.grouping === 'grouped' && !inGroup) {
			return false
		}
		if (filter.grouping === 'ungrouped' && inGroup) {
			return false
		}
		if (filter.audible && !row.audible) {
			return false
		}
		if (filter.duplicatesOnly && !duplicateUrls.value.has(row.url)) {
			return false
		}
		return (
			!term ||
			row.title.toLocaleLowerCase().includes(term) ||
			row.url.toLocaleLowerCase().includes(term)
		)
	})
})

function bucket<K>(tabs: Tab[], keyOf: (tab: Tab) => K) {
	const map = new Map<K, Tab[]>()
	for (const tab of tabs) {
		const key = keyOf(tab)
		const list = map.get(key)
		if (list) list.push(tab)
		else map.set(key, [tab])
	}
	return map
}

const lastVisitOf = (tab: Tab) => {
	const visits = tab.url ? props.lookUpTab[tab.url] : undefined
	if (!visits?.length) return 0
	return visits.reduce((latest, visit) => Math.max(latest, visit.visitTime ?? 0), 0)
}

// Biggest sites first; one-off sites are pooled into "Other sites" at the end
function sectionsBySite(tabs: Tab[]): TabSection[] {
	const sections: TabSection[] = []
	const other: Tab[] = []
	for (const [host, list] of bucket(tabs, (tab) => getHostname(tab.url))) {
		if (list.length < 2) {
			other.push(...list)
			continue
		}
		sections.push({
			key: `site:${host}`,
			label: host,
			tabs: list,
			favIconUrl: list.find((tab) => tab.favIconUrl)?.favIconUrl,
			url: list[0].url,
		})
	}
	sections.sort((a, b) => b.tabs.length - a.tabs.length || a.label.localeCompare(b.label))
	if (other.length) {
		sections.push({ key: 'site:other', label: 'Other sites', tabs: other, isOther: true })
	}
	return sections
}

// Tab-strip order, ungrouped tabs last
function sectionsByTabGroup(tabs: Tab[]): TabSection[] {
	const buckets = bucket(tabs, (tab) => (tab.groupId && tab.groupId !== -1 ? tab.groupId : -1))
	const order = new Map(props.loadedGroups.map((group, index) => [group.id, index]))
	const sections: TabSection[] = []
	for (const [groupId, list] of buckets) {
		if (groupId === -1) continue
		const group = groupById.value.get(groupId)
		sections.push({
			key: `group:${groupId}`,
			label: group?.title || 'Untitled group',
			tabs: list,
			groupId,
			color: tabGroupHex(group?.color),
		})
	}
	const rank = (section: TabSection) =>
		order.get(section.groupId ?? -1) ?? Number.MAX_SAFE_INTEGER
	sections.sort((a, b) => rank(a) - rank(b))
	const ungrouped = buckets.get(-1)
	if (ungrouped?.length) {
		sections.push({
			key: 'group:none',
			label: 'Not in a group',
			tabs: ungrouped,
			isOther: true,
		})
	}
	return sections
}

function sectionsByWindow(tabs: Tab[]): TabSection[] {
	const order = [...props.windowsMap.keys()]
	return [...bucket(tabs, (tab) => tab.windowId)]
		.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
		.map(([windowId, list]) => ({
			key: `window:${windowId}`,
			label: props.windowsMap.get(windowId) ?? 'Window',
			tabs: list,
		}))
}

// Most recent first; tabs without history land in "No recent visits"
function sectionsByDate(tabs: Tab[]): TabSection[] {
	const now = new Date()
	const byRecency = tabs
		.map((tab) => ({ tab, visit: lastVisitOf(tab) }))
		.sort((a, b) => b.visit - a.visit)
	const sections = new Map<string, TabSection & { order: number }>()
	for (const { tab, visit } of byRecency) {
		const range = visit
			? recencyBucket(new Date(visit), now)
			: { key: 'never', label: 'No recent visits', order: 99 }
		let section = sections.get(range.key)
		if (!section) {
			section = {
				key: `date:${range.key}`,
				label: range.label,
				tabs: [],
				order: range.order,
				isOther: range.key === 'never',
			}
			sections.set(range.key, section)
		}
		section.tabs.push(tab)
	}
	return [...sections.values()].sort((a, b) => a.order - b.order)
}

const sections = computed<TabSection[]>(() => {
	const tabs = visibleTabs.value
	switch (groupBy.value) {
		case 'group':
			return sectionsByTabGroup(tabs)
		case 'window':
			return sectionsByWindow(tabs)
		case 'date':
			return sectionsByDate(tabs)
		default:
			return sectionsBySite(tabs)
	}
})
const totalTabs = computed(() => visibleTabs.value.length)

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------
const collapsedKeys = ref(new Set<string>())
const isCollapsed = (key: string) => collapsedKeys.value.has(key)
const toggleCollapse = (key: string) => {
	const next = new Set(collapsedKeys.value)
	if (next.has(key)) next.delete(key)
	else next.add(key)
	collapsedKeys.value = next
}
const collapseAll = () => (collapsedKeys.value = new Set(sections.value.map((row) => row.key)))
const expandAll = () => (collapsedKeys.value = new Set())

const sectionSelection = (section: TabSection): 'none' | 'some' | 'all' => {
	let selected = 0
	for (const tab of section.tabs) {
		if (tabsSelected.value.has(tab.stableId)) selected++
	}
	if (selected === 0) return 'none'
	return selected === section.tabs.length ? 'all' : 'some'
}
const toggleSectionSelection = (section: TabSection) => {
	if (sectionSelection(section) === 'all') {
		section.tabs.forEach((tab) => tabsSelected.value.delete(tab.stableId))
	} else {
		selectGroup(section.tabs)
	}
}

const groupChipFor = (tab: Tab) => {
	if (groupBy.value === 'group' || !tab.groupId || tab.groupId === -1) return null
	const group = groupById.value.get(tab.groupId)
	return group
		? { title: group.title || 'Untitled group', color: tabGroupHex(group.color) }
		: null
}

const closeTabs = (tabs: Tab[]) => {
	if (!tabs.length) return
	closeTab(tabs)
	toast(`Closed ${pluralize(tabs.length, 'tab')}`, {
		action: {
			label: 'Undo',
			onClick: () => undoClose(tabs.length),
		},
	})
}

const closeSelectedTabs = () => {
	closeTabs(selectedGroup.value)
	tabsSelected.value.clear()
}
const closeUnSelectedTabs = () => {
	closeTabs(managedTabs.value.filter((row) => !tabsSelected.value.has(row.stableId)))
}

const saveAll = () => {
	storeSession(managedTabs.value)
	toast(`Saved ${pluralize(managedTabs.value.length, 'tab')} as a session`)
}

const removeDuplicates = () => {
	const count = duplicateExtraCount.value
	closeDuplicates(managedTabs.value)
	toast(count ? `Closed ${pluralize(count, 'duplicate')}` : 'No duplicates to close')
}

const saveAndCloseAll = async () => {
	const tabs = managedTabs.value
	await storeSession(tabs)
	closeTab(tabs)
	toast('Session saved and all tabs closed')
}

const closeAll = () => {
	const tabs = managedTabs.value
	triggerConfirm(() => closeTab(tabs), {
		title: `Close all ${pluralize(tabs.length, 'tab')}?`,
		message:
			'Every tab in every window will be closed. Save them as a session first if you want to come back to them.',
		confirmLabel: 'Close all',
	})
}

const copyLinks = (tabs: Tab[]) => {
	let content: string

	if (settings.value.copyLinksInMarkdownFormat) {
		content = tabs
			.map((tab) => formatTabAsMarkdown(tab))
			.filter((link) => link.length > 0)
			.join('\n\n')
	} else {
		content = tabs
			.map((row) => [row.url, row.title])
			.reduce((acc, curr) => {
				return `${acc}\n\n${curr[1]}\n${curr[0]}`
			}, '')
	}

	if (content) {
		copyToClipboard(content)
		toast(tabs.length === 1 ? 'Link copied' : `Copied ${pluralize(tabs.length, 'link')}`)
	}
}

const toggleSelection = (tab: Tab) => {
	if (tabsSelected.value.has(tab.stableId)) {
		tabsSelected.value.delete(tab.stableId)
	} else {
		tabsSelected.value.add(tab.stableId)
	}
}
const selectGroup = (tabs: Tab[]) => {
	tabs.forEach((tab) => {
		tabsSelected.value.add(tab.stableId)
	})
}
const activeElement = useActiveElement()
const isInputFocused = computed(() => !!inputRef.value && activeElement.value === inputRef.value)

// Tabs of expanded sections, in display order (select all / save act on these)
const flatTabs = computed(() => {
	return sections.value
		.filter((section) => !isCollapsed(section.key))
		.flatMap((section) => section.tabs)
})

// ---------------------------------------------------------------------------
// Rows: every section header plus the tabs of expanded sections. The keyboard
// cursor, the virtualized list and the grid all index into this one list.
// ---------------------------------------------------------------------------
type Row =
	| { type: 'header'; key: string; section: TabSection }
	| { type: 'tab'; key: string; tab: Tab; section: TabSection }

const tabRowKey = (section: TabSection, tab: Tab) =>
	`${section.key}|${tab.windowId}-${tab.stableId}`

const rows = computed<Row[]>(() => {
	const items: Row[] = []
	for (const section of sections.value) {
		items.push({ type: 'header', key: section.key, section })
		if (isCollapsed(section.key)) continue
		for (const tab of section.tabs) {
			items.push({ type: 'tab', key: tabRowKey(section, tab), tab, section })
		}
	}
	return items
})

const rowIndexByKey = computed(() => new Map(rows.value.map((row, index) => [row.key, index])))
const headerRowIndexes = computed(() =>
	rows.value.flatMap((row, index) => (row.type === 'header' ? [index] : [])),
)
const firstTabRowIndex = () =>
	Math.max(
		0,
		rows.value.findIndex((row) => row.type === 'tab'),
	)

/** Tabs covered by `count` rows from `start`; a header row covers its whole group */
const tabsInRows = (start: number, count: number): Tab[] => {
	const tabs = new Map<string, Tab>()
	for (const row of rows.value.slice(start, start + count)) {
		for (const tab of row.type === 'header' ? row.section.tabs : [row.tab]) {
			tabs.set(tab.stableId, tab)
		}
	}
	return [...tabs.values()]
}

const sectionHeaderBindings = (section: TabSection) => ({
	section,
	groupBy: groupBy.value,
	collapsed: isCollapsed(section.key),
	selection: sectionSelection(section),
	canEdit: groupBy.value === 'group' && !section.isOther,
	isCursor: rows.value[cursorIndex.value]?.key === section.key,
	windowsMap: props.windowsMap,
	loadedGroups: props.loadedGroups,
	onFocus: () => {
		const index = rowIndexByKey.value.get(section.key)
		if (index !== undefined) cursorIndex.value = index
	},
	onToggleCollapse: () => toggleCollapse(section.key),
	onToggleSelect: () => toggleSectionSelection(section),
	onCopy: () => copyLinks(section.tabs),
	onClose: () => closeTabs(section.tabs),
	onEdit: () => onEditGroup({ tabs: section.tabs }),
	onCreateGroup: ({ tabs }: { tabs: Tab[] }) => onCreateNewGroup({ tabs }),
})

// ---------------------------------------------------------------------------
// Virtualized list view (section headers + rows)
// ---------------------------------------------------------------------------
const ROW_HEIGHT = 44
const HEADER_HEIGHT = 40

const listRef = ref<HTMLElement | null>(null)
const stickyHeaderRef = ref<HTMLElement | null>(null)
// Document offset of the list (virtualizer scrollMargin)
const listOffset = ref(0)
// Viewport offset where content disappears under the sticky toolbar
const stickyOffset = ref(0)

const measureLayout = () => {
	listOffset.value = listRef.value
		? listRef.value.getBoundingClientRect().top + window.scrollY
		: 0
	const toolbar = stickyHeaderRef.value
	if (toolbar) {
		stickyOffset.value = (parseFloat(getComputedStyle(toolbar).top) || 0) + toolbar.offsetHeight
	}
}
watch(listRef, () => nextTick(measureLayout))
useResizeObserver(stickyHeaderRef, measureLayout)
useResizeObserver(typeof document !== 'undefined' ? document.body : null, measureLayout)
useEventListener(typeof window !== 'undefined' ? window : null, 'resize', measureLayout)
onMounted(measureLayout)

const virtualizerOptions = computed(() => ({
	count: rows.value.length,
	estimateSize: (index: number) =>
		rows.value[index]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT,
	getItemKey: (index: number) => rows.value[index]?.key ?? index,
	overscan: 12,
	scrollMargin: listOffset.value,
}))
const rowVirtualizer = useWindowVirtualizer(virtualizerOptions)
const listTotalSize = computed(() => rowVirtualizer.value.getTotalSize())
const virtualRows = computed(() =>
	rowVirtualizer.value
		.getVirtualItems()
		.map((row) => ({ index: row.index, start: row.start, item: rows.value[row.index] }))
		.filter((row) => row.item),
)
const measureRow = (el: Element | ComponentPublicInstance | null) => {
	if (el instanceof HTMLElement) {
		rowVirtualizer.value.measureElement(el)
	}
}

// Rows are absolutely positioned, so the current section's header is pinned
// with a separate overlay that gets pushed up by the next header.
const { y: windowScrollY } = useWindowScroll()
const stickySection = computed(() => {
	if (!isListView.value) return null
	const measurements = rowVirtualizer.value.measurementsCache
	const line = windowScrollY.value + stickyOffset.value
	let active = -1
	let next = -1
	for (const index of headerRowIndexes.value) {
		const measured = measurements[index]
		if (!measured) break
		if (measured.start <= line) {
			active = index
		} else {
			next = index
			break
		}
	}
	const current = rows.value[active]
	if (!current || current.type !== 'header') return null
	const nextStart = next === -1 ? Infinity : measurements[next].start
	return {
		section: current.section,
		offset: Math.min(0, nextStart - line - HEADER_HEIGHT),
	}
})

// ---------------------------------------------------------------------------
// Cursor (vim-style) model
// ---------------------------------------------------------------------------
const scrollCursorIntoView = () => {
	const row = rows.value[cursorIndex.value]
	if (!row) return
	if (!isListView.value) {
		nextTick(() => {
			document
				.querySelector(`[data-row-index="${cursorIndex.value}"]`)
				?.scrollIntoView({ block: 'nearest' })
		})
		return
	}
	// Manual scroll math so rows clear the sticky toolbar, the pinned header and the statusline
	const isHeader = row.type === 'header'
	const measured = rowVirtualizer.value.measurementsCache[cursorIndex.value]
	const itemTop = measured?.start ?? cursorIndex.value * ROW_HEIGHT + listOffset.value
	const itemSize = measured?.size ?? (isHeader ? HEADER_HEIGHT : ROW_HEIGHT)
	// A header may sit right under the toolbar; tab rows must also clear the pinned header
	const topClearance = stickyOffset.value + (isHeader ? 0 : HEADER_HEIGHT)
	const bottomClearance = 40 + (tabsSelected.value.size > 0 ? 64 : 0)
	const viewTop = window.scrollY + topClearance
	const viewBottom = window.scrollY + window.innerHeight - bottomClearance
	if (itemTop < viewTop) {
		window.scrollTo({ top: Math.max(0, itemTop - topClearance) })
	} else if (itemTop + itemSize > viewBottom) {
		window.scrollTo({ top: itemTop + itemSize - window.innerHeight + bottomClearance })
	}
}

// ---------------------------------------------------------------------------
// Visual mode (vim-style range selection)
// ---------------------------------------------------------------------------
const visualAnchor = ref<number | null>(null)
let preVisualSelection = new Set<string>()

const applyVisualRange = () => {
	if (visualAnchor.value === null) return
	const from = Math.min(visualAnchor.value, cursorIndex.value)
	const to = Math.max(visualAnchor.value, cursorIndex.value)
	const next = new Set(preVisualSelection)
	for (const tab of tabsInRows(from, to - from + 1)) next.add(tab.stableId)
	tabsSelected.value = next
}

const enterVisual = () => {
	if (!rows.value.length) return
	preVisualSelection = new Set(tabsSelected.value)
	visualAnchor.value = cursorIndex.value
	applyVisualRange()
}

const exitVisual = (restoreSelection: boolean) => {
	if (visualAnchor.value === null) return
	if (restoreSelection) {
		tabsSelected.value = new Set(preVisualSelection)
	}
	visualAnchor.value = null
}

const afterCursorMove = () => {
	applyVisualRange()
	scrollCursorIntoView()
}

const moveCursorTo = (index: number) => {
	const total = rows.value.length
	if (!total) return
	cursorIndex.value = Math.min(Math.max(index, 0), total - 1)
	afterCursorMove()
}
const moveCursor = (delta: number) => moveCursorTo(cursorIndex.value + delta)
const halfPage = () => Math.max(1, Math.round(window.innerHeight / 2 / ROW_HEIGHT))

// { / } land on group headers, so Enter or za can fold the group straight away
const jumpGroup = (direction: 1 | -1) => {
	const headers = headerRowIndexes.value
	if (!headers.length) return
	if (direction === 1) {
		const next = headers.find((index) => index > cursorIndex.value)
		moveCursorTo(next !== undefined ? next : rows.value.length - 1)
	} else {
		const prev = [...headers].reverse().find((index) => index < cursorIndex.value)
		moveCursorTo(prev !== undefined ? prev : 0)
	}
}

const switchCategory = (direction: 1 | -1) => {
	const current = groupByOptions.findIndex((option) => option.value === groupBy.value)
	const next = Math.min(Math.max(current + direction, 0), groupByOptions.length - 1)
	groupBy.value = groupByOptions[next].value
}

// ---------------------------------------------------------------------------
// Keyboard actions
// ---------------------------------------------------------------------------
const cursorRow = computed(() => rows.value[cursorIndex.value])

/** Selection wins; otherwise `count` rows from the cursor (vim: 3dd). A header row covers its group. */
const targetTabs = (count = 1): Tab[] => {
	if (tabsSelected.value.size > 0) return selectedGroup.value
	return tabsInRows(cursorIndex.value, count)
}

/** Enter / o: open the tab, or fold / unfold the group on a header */
const activateCursor = () => {
	const row = cursorRow.value
	if (!row) return
	if (row.type === 'header') toggleCollapse(row.section.key)
	else goToTab(row.tab)
}

const openTab = (tab: Tab, rowIndex?: number) => {
	if (rowIndex !== undefined) cursorIndex.value = rowIndex
	goToTab(tab)
}

const toggleCursorSelection = () => {
	const row = cursorRow.value
	if (!row) return
	if (row.type === 'header') toggleSectionSelection(row.section)
	else toggleSelection(row.tab)
}

// Fold the cursor's group (vim: za); the cursor ends up on the group's header
const toggleCursorSection = () => {
	const row = cursorRow.value
	if (!row) return
	toggleCollapse(row.section.key)
	nextTick(() => {
		const header = rowIndexByKey.value.get(row.section.key)
		if (header !== undefined) cursorIndex.value = header
		afterCursorMove()
	})
}

const selectSameDomain = () => {
	const row = cursorRow.value
	if (row?.type === 'header') {
		selectGroup(row.section.tabs)
		toast(`Selected ${pluralize(row.section.tabs.length, 'tab')} in ${row.section.label}`)
		return
	}
	const current = row?.tab
	if (!current?.url) return
	let host: string
	try {
		host = new URL(current.url).hostname
	} catch {
		return
	}
	let added = 0
	for (const tab of flatTabs.value) {
		if (!tab.url) continue
		try {
			if (new URL(tab.url).hostname === host) {
				tabsSelected.value.add(tab.stableId)
				added++
			}
		} catch {
			// ignore malformed URLs
		}
	}
	toast(`Selected ${pluralize(added, 'tab')} on ${host}`)
}

const closeTargets = (count: number) => {
	const hadSelection = tabsSelected.value.size > 0
	const targets = targetTabs(count)
	if (!targets.length) return
	closeTabs(targets)
	if (hadSelection) tabsSelected.value.clear()
}

/** Backspace / Delete: close what's under the cursor, even when tabs are selected */
const closeCursorRows = (count: number) => {
	const targets = tabsInRows(cursorIndex.value, count)
	if (targets.length) closeTabs(targets)
}

const undoClose = async (count = 1) => {
	const restored = await undoCloseTabs(count)
	toast(restored ? `Restored ${pluralize(restored, 'tab')}` : 'Nothing to restore')
}

const togglePin = async (tabs: Tab[]) => {
	if (!tabs.length) return
	const shouldPin = tabs.some((row) => !row.pinned)
	await pinTabs(tabs, shouldPin)
	toast(`${shouldPin ? 'Pinned' : 'Unpinned'} ${pluralize(tabs.length, 'tab')}`)
}

const saveTargets = () => {
	const targets = tabsSelected.value.size > 0 ? selectedGroup.value : flatTabs.value
	if (!targets.length) return
	storeSession(targets)
	toast(`Saved ${pluralize(targets.length, 'tab')} as a session`)
}

/** Progressive escape: visual mode is handled separately; then selection, then search. */
const escapeNormal = () => {
	if (tabsSelected.value.size > 0) {
		tabsSelected.value.clear()
		return
	}
	if (searchTerm.value) {
		searchTerm.value = ''
	}
}

// ---------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------
const keymapMode = computed<KeymapMode>(() => {
	if (isInputFocused.value) return 'search'
	if (visualAnchor.value !== null) return 'visual'
	return 'normal'
})

const allBindings: KeyBinding[] = [
	// Navigation
	{
		id: 'nav-down',
		keys: 'j',
		group: 'Navigation',
		description: 'Move down (also ↓)',
		repeat: true,
		run: ({ count }) => moveCursor(count),
	},
	{
		id: 'nav-down-arrow',
		keys: 'arrowdown',
		group: 'Navigation',
		description: 'Move down',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(count),
	},
	{
		id: 'nav-down-ctrl-n',
		keys: 'ctrl+n',
		group: 'Navigation',
		description: 'Move down',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(count),
	},
	{
		id: 'nav-up',
		keys: 'k',
		group: 'Navigation',
		description: 'Move up (also ↑)',
		repeat: true,
		run: ({ count }) => moveCursor(-count),
	},
	{
		id: 'nav-up-arrow',
		keys: 'arrowup',
		group: 'Navigation',
		description: 'Move up',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(-count),
	},
	{
		id: 'nav-up-ctrl-p',
		keys: 'ctrl+p',
		group: 'Navigation',
		description: 'Move up',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(-count),
	},
	{
		id: 'nav-half-down',
		keys: 'ctrl+d',
		modes: ['normal', 'visual', 'search'],
		group: 'Navigation',
		description: 'Half page down (also PgDn)',
		repeat: true,
		run: ({ count }) => moveCursor(halfPage() * count),
	},
	{
		id: 'nav-half-up',
		keys: 'ctrl+u',
		modes: ['normal', 'visual', 'search'],
		group: 'Navigation',
		description: 'Half page up (also PgUp)',
		repeat: true,
		run: ({ count }) => moveCursor(-halfPage() * count),
	},
	{
		id: 'nav-half-down-pagedown',
		keys: 'pagedown',
		modes: ['normal', 'visual', 'search'],
		group: 'Navigation',
		description: 'Half page down',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(halfPage() * count),
	},
	{
		id: 'nav-half-up-pageup',
		keys: 'pageup',
		modes: ['normal', 'visual', 'search'],
		group: 'Navigation',
		description: 'Half page up',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(-halfPage() * count),
	},
	{
		id: 'nav-first',
		keys: 'g g',
		group: 'Navigation',
		description: 'Top of the list',
		run: ({ count }) => moveCursorTo(count > 1 ? count - 1 : 0),
	},
	{
		id: 'nav-last',
		keys: 'G',
		group: 'Navigation',
		description: 'Bottom of the list',
		run: ({ count }) => moveCursorTo(count > 1 ? count - 1 : rows.value.length - 1),
	},
	{
		id: 'nav-group-next',
		keys: '}',
		group: 'Navigation',
		description: 'Next group header',
		run: () => jumpGroup(1),
	},
	{
		id: 'nav-group-prev',
		keys: '{',
		group: 'Navigation',
		description: 'Previous group header',
		run: () => jumpGroup(-1),
	},
	{
		id: 'nav-category-prev',
		keys: 'h',
		modes: ['normal'],
		group: 'Navigation',
		description: 'Previous grouping',
		run: () => switchCategory(-1),
	},
	{
		id: 'nav-category-next',
		keys: 'l',
		modes: ['normal'],
		group: 'Navigation',
		description: 'Next grouping',
		run: () => switchCategory(1),
	},

	// Selection
	{
		id: 'select-toggle',
		keys: 'x',
		modes: ['normal'],
		group: 'Selection',
		description: 'Select tab or group (also Space)',
		run: () => toggleCursorSelection(),
	},
	{
		id: 'select-toggle-space',
		keys: 'space',
		modes: ['normal'],
		group: 'Selection',
		description: 'Toggle selection',
		hidden: true,
		run: () => toggleCursorSelection(),
	},
	{
		id: 'select-toggle-ctrl-space',
		keys: 'ctrl+space',
		modes: ['normal', 'search'],
		group: 'Selection',
		description: 'Toggle selection',
		hidden: true,
		run: () => toggleCursorSelection(),
	},
	{
		id: 'select-visual',
		keys: 'v',
		modes: ['normal'],
		group: 'Selection',
		description: 'Visual mode (range select)',
		run: () => enterVisual(),
	},
	{
		id: 'select-visual-exit',
		keys: 'v',
		modes: ['visual'],
		group: 'Selection',
		description: 'Exit visual mode',
		hidden: true,
		run: () => exitVisual(false),
	},
	{
		id: 'select-same-domain',
		keys: '*',
		modes: ['normal'],
		group: 'Selection',
		description: 'Select all tabs on this domain',
		run: () => selectSameDomain(),
	},
	{
		id: 'select-all',
		keys: 'ctrl+a',
		modes: ['normal'],
		group: 'Selection',
		description: 'Select all (filtered)',
		run: () => {
			tabsSelected.value.clear()
			selectGroup(flatTabs.value)
		},
	},
	{
		id: 'select-clear',
		keys: 'escape',
		modes: ['normal'],
		group: 'Selection',
		description: 'Clear selection, then search',
		run: () => escapeNormal(),
	},
	{
		id: 'select-visual-cancel',
		keys: 'escape',
		modes: ['visual'],
		group: 'Selection',
		description: 'Cancel visual selection',
		hidden: true,
		run: () => exitVisual(true),
	},

	// Actions
	{
		id: 'action-open',
		keys: 'enter',
		group: 'Actions',
		description: 'Open tab / fold group (also o)',
		run: () => activateCursor(),
	},
	{
		id: 'action-open-o',
		keys: 'o',
		modes: ['normal'],
		group: 'Actions',
		description: 'Open tab',
		hidden: true,
		run: () => activateCursor(),
	},
	{
		id: 'action-close',
		keys: 'd d',
		modes: ['normal'],
		group: 'Actions',
		description: 'Close selection, else row under cursor',
		run: ({ count }) => closeTargets(count),
	},
	{
		id: 'action-close-row',
		keys: 'backspace',
		modes: ['normal'],
		group: 'Actions',
		description: 'Close cursor row only (also Del)',
		run: ({ count }) => closeCursorRows(count),
	},
	{
		id: 'action-close-row-delete',
		keys: 'delete',
		modes: ['normal'],
		group: 'Actions',
		description: 'Close cursor row only',
		hidden: true,
		run: ({ count }) => closeCursorRows(count),
	},
	{
		id: 'action-close-visual',
		keys: 'd',
		modes: ['visual'],
		group: 'Actions',
		description: 'Close visual selection',
		run: () => {
			exitVisual(false)
			closeTargets(1)
		},
	},
	{
		id: 'action-close-visual-backspace',
		keys: 'backspace',
		modes: ['visual'],
		group: 'Actions',
		description: 'Close visual selection',
		hidden: true,
		run: () => {
			exitVisual(false)
			closeTargets(1)
		},
	},
	{
		id: 'action-close-visual-delete',
		keys: 'delete',
		modes: ['visual'],
		group: 'Actions',
		description: 'Close visual selection',
		hidden: true,
		run: () => {
			exitVisual(false)
			closeTargets(1)
		},
	},
	{
		id: 'action-close-others',
		keys: 'shift+delete',
		modes: ['normal'],
		group: 'Actions',
		description: 'Close unselected tabs',
		run: () => {
			if (tabsSelected.value.size > 0) closeUnSelectedTabs()
		},
	},
	{
		id: 'action-undo',
		keys: 'u',
		modes: ['normal'],
		group: 'Actions',
		description: 'Reopen last closed tab',
		run: ({ count }) => undoClose(count),
	},
	{
		id: 'action-copy',
		keys: 'y y',
		modes: ['normal'],
		group: 'Actions',
		description: 'Copy link(s) (also c)',
		run: ({ count }) => copyLinks(targetTabs(count)),
	},
	{
		id: 'action-copy-visual',
		keys: 'y',
		modes: ['visual'],
		group: 'Actions',
		description: 'Copy visual selection',
		hidden: true,
		run: () => {
			copyLinks(targetTabs(1))
			exitVisual(false)
		},
	},
	{
		id: 'action-copy-c',
		keys: 'c',
		modes: ['normal'],
		group: 'Actions',
		description: 'Copy link(s)',
		hidden: true,
		run: ({ count }) => copyLinks(targetTabs(count)),
	},
	{
		id: 'action-pin',
		keys: 'p',
		modes: ['normal'],
		group: 'Actions',
		description: 'Pin / unpin',
		run: ({ count }) => togglePin(targetTabs(count)),
	},
	{
		id: 'action-move-window',
		keys: 'm w',
		group: 'Actions',
		description: 'Move to new window',
		run: ({ count }) => {
			const targets = targetTabs(count)
			exitVisual(false)
			moveTabs(targets)
		},
	},
	{
		id: 'action-move-group',
		keys: 'm g',
		group: 'Actions',
		description: 'Add to new group…',
		run: ({ count }) => {
			const targets = targetTabs(count)
			exitVisual(false)
			onCreateNewGroup({ tabs: targets })
		},
	},
	{
		id: 'action-save',
		keys: 's',
		modes: ['normal'],
		group: 'Actions',
		description: 'Save session (selection or filtered)',
		run: () => saveTargets(),
	},

	// View & search
	{
		id: 'view-search',
		keys: '/',
		modes: ['normal'],
		group: 'View & search',
		description: 'Focus search',
		run: () => focusOnInput(),
	},
	{
		id: 'view-palette',
		keys: ':',
		modes: ['normal'],
		group: 'View & search',
		description: `Command palette (${paletteShortcutLabel})`,
		run: () => openPalette(),
	},
	{
		id: 'view-toggle',
		keys: 't',
		modes: ['normal'],
		group: 'View & search',
		description: 'Toggle list / grid view',
		run: () => (isListView.value = !isListView.value),
	},
	{
		id: 'view-help',
		keys: '?',
		modes: ['normal'],
		group: 'View & search',
		description: 'Keyboard shortcuts help',
		run: () => (helpOpen.value = !helpOpen.value),
	},
	{
		id: 'fold-toggle',
		keys: 'z a',
		modes: ['normal'],
		group: 'View & search',
		description: 'Fold / unfold group under cursor',
		run: () => toggleCursorSection(),
	},
	{
		id: 'fold-close-all',
		keys: 'z M',
		modes: ['normal'],
		group: 'View & search',
		description: 'Collapse all groups',
		run: () => collapseAll(),
	},
	{
		id: 'fold-open-all',
		keys: 'z R',
		modes: ['normal'],
		group: 'View & search',
		description: 'Expand all groups',
		run: () => expandAll(),
	},

	// While searching
	{
		id: 'search-down',
		keys: 'ctrl+j',
		modes: ['search'],
		group: 'While searching',
		description: isMac ? 'Move down (also Ctrl-n, ↓)' : 'Move down (also ↓)',
		repeat: true,
		run: ({ count }) => moveCursor(count),
	},
	{
		id: 'search-down-n',
		keys: 'ctrl+n',
		modes: ['search'],
		group: 'While searching',
		description: 'Move down',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(count),
	},
	{
		id: 'search-down-arrow',
		keys: 'arrowdown',
		modes: ['search'],
		group: 'While searching',
		description: 'Move down',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(count),
	},
	// Outside macOS Ctrl+K opens the command palette, so Ctrl+P is the "up" chord there
	...(isMac
		? ([
				{
					id: 'search-up',
					keys: 'ctrl+k',
					modes: ['search'],
					group: 'While searching',
					description: 'Move up (also Ctrl-p, ↑)',
					repeat: true,
					run: ({ count }) => moveCursor(-count),
				},
			] satisfies KeyBinding[])
		: []),
	{
		id: 'search-up-p',
		keys: 'ctrl+p',
		modes: ['search'],
		group: 'While searching',
		description: isMac ? 'Move up' : 'Move up (also ↑)',
		hidden: isMac,
		repeat: true,
		run: ({ count }) => moveCursor(-count),
	},
	{
		id: 'search-up-arrow',
		keys: 'arrowup',
		modes: ['search'],
		group: 'While searching',
		description: 'Move up',
		hidden: true,
		repeat: true,
		run: ({ count }) => moveCursor(-count),
	},
	{
		id: 'search-open',
		keys: 'enter',
		modes: ['search'],
		group: 'While searching',
		description: 'Open tab / fold group',
		run: () => activateCursor(),
	},
	{
		id: 'search-exit',
		keys: 'escape',
		modes: ['search'],
		group: 'While searching',
		description: 'Back to list (keep filter)',
		run: () => inputRef.value?.blur(),
	},
]

// Chords Chrome keeps for itself (Ctrl+N outside macOS, …) would never fire, so they're
// dropped rather than listed in the help
const reservedChords = new Set(browserReservedCtrlKeys.map((key) => `ctrl+${key}`))
const bindings = allBindings.filter(
	(binding) => !binding.keys.split(' ').some((token) => reservedChords.has(token)),
)

// In the search box, Ctrl+<key> runs that key's normal-mode command (Ctrl+x selects,
// Ctrl+Backspace closes). Visual mode can't start from the search box. Outside macOS,
// Ctrl+A/C/X/Y/Z/Backspace keep editing the text, Ctrl+K belongs to the command palette
// and Chrome keeps Ctrl+N/T/PgUp/PgDn.
const ctrlLayer: CtrlLayer = {
	from: 'search',
	to: 'normal',
	exclude: [
		'escape',
		'enter',
		'v',
		...(isMac ? [] : ['a', 'c', 'x', 'y', 'z', 'k', 'backspace']),
		...browserReservedCtrlKeys,
	],
}

const { pendingDisplay, whichKey, ctrlHeld, ctrlHints } = useKeymap({
	mode: () => keymapMode.value,
	bindings: () => bindings,
	ctrlLayer,
})

// Keep the cursor on the same row as the list changes. A new query starts on the first
// tab so Enter opens the best match. When the cursor's row disappears, it moves to the
// group header if that group was folded, otherwise it stays put (landing on the next row).
const queryKey = computed(() => JSON.stringify([searchTerm.value, groupBy.value, filter]))
watch([rows, queryKey], ([nextRows, query], [prevRows, prevQuery]) => {
	if (query !== prevQuery || !prevRows.length) {
		if (query !== prevQuery) exitVisual(false)
		cursorIndex.value = firstTabRowIndex()
		return
	}
	if (!nextRows.length) {
		cursorIndex.value = 0
		return
	}
	const previous = prevRows[cursorIndex.value]
	const kept = previous ? rowIndexByKey.value.get(previous.key) : undefined
	if (kept !== undefined) {
		cursorIndex.value = kept
		return
	}
	if (previous?.type === 'tab' && isCollapsed(previous.section.key)) {
		const header = rowIndexByKey.value.get(previous.section.key)
		if (header !== undefined) {
			cursorIndex.value = header
			return
		}
	}
	cursorIndex.value = Math.min(cursorIndex.value, nextRows.length - 1)
})

// Drop selections for tabs that were closed elsewhere
watch(
	() => props.loadedTabs,
	(tabs) => {
		if (!tabsSelected.value.size) return
		const alive = new Set(tabs.map((tab) => tab.stableId))
		for (const id of tabsSelected.value) {
			if (!alive.has(id)) tabsSelected.value.delete(id)
		}
	},
)

// Load settings on component mount
onMounted(() => {
	loadSettings()
})
</script>

<template>
	<div class="relative">
		<!-- Toolbar -->
		<div
			ref="stickyHeaderRef"
			class="dark:bg-vercel-accents-1 sticky top-(--app-header-height) z-20 bg-slate-50"
		>
			<div class="page-container py-3">
				<h1 class="sr-only">Tab Manager</h1>
				<div class="flex flex-wrap items-center gap-2">
					<div class="min-w-60 flex-1">
						<SearchInput
							ref="searchInput"
							v-model="searchTerm"
							autofocus
							placeholder="Search tabs by title or URL…"
						>
							<template #trailing>
								<span
									v-if="searchTerm"
									class="dark:text-vercel-accents-5 shrink-0 text-xs text-slate-400 tabular-nums"
								>
									{{ pluralize(totalTabs, 'result') }}
								</span>
								<kbd v-else class="kbd hidden sm:inline-flex">/</kbd>
							</template>
						</SearchInput>
					</div>

					<Popover class="relative">
						<PopoverButton
							:class="[
								button({ intent: 'secondary' }),
								activeFilterCount
									? 'border-blue-300 text-blue-700 dark:border-blue-500/50 dark:text-blue-300'
									: '',
							]"
						>
							<FunnelIcon class="size-4" aria-hidden="true" />
							<span class="hidden sm:inline">Filters</span>
							<span
								v-if="activeFilterCount"
								class="flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white tabular-nums"
							>
								{{ activeFilterCount }}
							</span>
						</PopoverButton>
						<transition
							enter-active-class="transition duration-100 ease-out"
							enter-from-class="scale-95 opacity-0"
							enter-to-class="scale-100 opacity-100"
							leave-active-class="transition duration-75 ease-in"
							leave-from-class="scale-100 opacity-100"
							leave-to-class="scale-95 opacity-0"
						>
							<PopoverPanel
								class="menu-panel absolute top-full right-0 z-40 mt-1.5 w-80 origin-top-right"
							>
								<div class="p-3">
									<div class="flex h-6 items-center justify-between">
										<h3
											class="text-sm font-semibold text-slate-900 dark:text-white"
										>
											Filters
										</h3>
										<button
											v-if="activeFilterCount"
											type="button"
											class="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
											@click="clearFilters"
										>
											Clear all
										</button>
									</div>

									<div class="mt-3 space-y-3">
										<div class="space-y-1.5">
											<p class="section-label">Pinned</p>
											<SegmentedControl
												v-model="filter.pinned"
												label="Pinned"
												:options="pinnedOptions"
												size="sm"
												block
											/>
										</div>
										<div class="space-y-1.5">
											<p class="section-label">Tab groups</p>
											<SegmentedControl
												v-model="filter.grouping"
												label="Tab groups"
												:options="groupingOptions"
												size="sm"
												block
											/>
										</div>
										<div class="space-y-2 pt-1">
											<label
												class="dark:text-vercel-accents-7 flex cursor-pointer items-center gap-2.5 text-sm text-slate-700"
											>
												<input
													v-model="filter.audible"
													type="checkbox"
													class="checkbox"
												/>
												Playing audio
											</label>
											<label
												class="dark:text-vercel-accents-7 flex cursor-pointer items-center gap-2.5 text-sm text-slate-700"
											>
												<input
													v-model="filter.duplicatesOnly"
													type="checkbox"
													class="checkbox"
												/>
												Duplicates only
												<span
													v-if="duplicateUrls.size"
													class="dark:text-vercel-accents-4 ml-auto text-xs text-slate-400 tabular-nums"
												>
													{{ duplicateExtraCount }} extra
												</span>
											</label>
										</div>
									</div>
								</div>

								<div class="menu-separator" />

								<div class="space-y-3 p-3">
									<div class="flex items-center justify-between">
										<p
											class="dark:text-vercel-accents-7 text-sm font-medium text-slate-700"
										>
											Last visited
										</p>
										<AppSwitch
											v-model="filter.has_date_range"
											size="sm"
											label="Filter by last visit"
										/>
									</div>
									<template v-if="filter.has_date_range">
										<div class="flex flex-wrap gap-1.5">
											<button
												v-for="preset in datePresets"
												:key="preset.label"
												type="button"
												:class="
													presetPillClass(
														activeDatePreset === preset.label,
													)
												"
												@click="applyDatePreset(preset)"
											>
												{{ preset.label }}
											</button>
											<button
												type="button"
												:class="
													presetPillClass(activeDatePreset === 'custom')
												"
												@click="activeDatePreset = 'custom'"
											>
												Custom
											</button>
										</div>
										<div v-if="activeDatePreset === 'custom'" class="space-y-2">
											<SegmentedControl
												v-model="filter.date_range_type"
												label="Range type"
												:options="rangeOptions"
												size="sm"
												block
											/>
											<v-date-picker
												v-if="ranges[filter.date_range_type].is_range"
												v-model="filter.range"
												mode="dateTime"
												:masks="masks"
												is-range
											>
												<template #default="{ inputValue, inputEvents }">
													<div class="grid grid-cols-2 gap-2">
														<div class="relative">
															<CalendarDaysIcon
																class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400"
															/>
															<input
																class="field h-8 pl-8 text-xs"
																type="text"
																:value="inputValue.start"
																placeholder="Start"
																v-on="inputEvents.start"
															/>
														</div>
														<div class="relative">
															<CalendarDaysIcon
																class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400"
															/>
															<input
																class="field h-8 pl-8 text-xs"
																type="text"
																:value="inputValue.end"
																placeholder="End"
																v-on="inputEvents.end"
															/>
														</div>
													</div>
												</template>
											</v-date-picker>
											<v-date-picker
												v-else
												v-model="filter.date"
												mode="dateTime"
												:masks="masks"
											>
												<template #default="{ inputValue, inputEvents }">
													<div class="relative">
														<CalendarDaysIcon
															class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400"
														/>
														<input
															class="field h-8 pl-8 text-xs"
															type="text"
															:value="inputValue"
															placeholder="Select date"
															v-on="inputEvents"
														/>
													</div>
												</template>
											</v-date-picker>
										</div>
									</template>
								</div>
							</PopoverPanel>
						</transition>
					</Popover>

					<div
						class="dark:bg-vercel-accents-2 mx-1 hidden h-5 w-px bg-slate-200 sm:block"
						aria-hidden="true"
					/>

					<SegmentedControl
						v-model="groupBy"
						label="Group tabs by"
						:options="groupByOptions"
						:icon-only="!isWide"
					/>
					<SegmentedControl
						v-model="viewMode"
						label="View"
						:options="viewOptions"
						icon-only
					/>

					<Menu as="div" class="relative">
						<MenuButton
							:class="button({ intent: 'secondary', square: true })"
							title="More actions"
						>
							<span class="sr-only">More actions</span>
							<EllipsisHorizontalIcon class="size-4" aria-hidden="true" />
						</MenuButton>
						<AppMenuItems width="w-64">
							<AppMenuItem :icon="BookmarkIcon" @click="saveAll">
								Save all as session
							</AppMenuItem>
							<AppMenuItem :icon="ArchiveBoxArrowDownIcon" @click="saveAndCloseAll">
								Save session &amp; close all
							</AppMenuItem>
							<AppMenuItem
								:icon="Square2StackIcon"
								:disabled="!duplicateExtraCount"
								@click="removeDuplicates"
							>
								Close duplicates
								<template #trailing>
									<span
										class="dark:text-vercel-accents-4 text-xs text-slate-400 tabular-nums"
									>
										{{ duplicateExtraCount }}
									</span>
								</template>
							</AppMenuItem>
							<div class="menu-separator" />
							<AppMenuItem :icon="ArrowsPointingInIcon" @click="collapseAll">
								Collapse all groups
								<template #trailing><kbd class="kbd">zM</kbd></template>
							</AppMenuItem>
							<AppMenuItem :icon="ArrowsPointingOutIcon" @click="expandAll">
								Expand all groups
								<template #trailing><kbd class="kbd">zR</kbd></template>
							</AppMenuItem>
							<div class="menu-separator" />
							<AppMenuItem :icon="TrashIcon" danger @click="closeAll">
								Close all tabs…
							</AppMenuItem>
						</AppMenuItems>
					</Menu>
				</div>

				<div
					v-if="activeFilterChips.length"
					class="mt-2.5 flex flex-wrap items-center gap-1.5"
				>
					<span class="dark:text-vercel-accents-5 mr-0.5 text-xs text-slate-500">
						Filtered by
					</span>
					<button
						v-for="chip in activeFilterChips"
						:key="chip.key"
						type="button"
						class="group inline-flex h-6 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 pr-1.5 pl-2.5 text-xs font-medium text-blue-700 hover:border-blue-300 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
						:title="`Remove “${chip.label}” filter`"
						@click="chip.clear()"
					>
						{{ chip.label }}
						<XMarkIcon
							class="size-3 opacity-60 group-hover:opacity-100"
							aria-hidden="true"
						/>
					</button>
					<button
						type="button"
						class="dark:text-vercel-accents-5 ml-1 text-xs text-slate-500 hover:text-slate-900 hover:underline dark:hover:text-white"
						@click="clearFilters"
					>
						Clear all
					</button>
				</div>
			</div>
		</div>

		<div :class="['page-container', tabsSelected.size > 0 ? 'pb-36' : 'pb-16']">
			<!-- List view (virtualized) -->
			<div v-if="isListView && rows.length" ref="listRef" class="card overflow-clip">
				<div
					v-if="stickySection"
					class="sticky z-10 h-0"
					:style="{ top: `${stickyOffset}px` }"
				>
					<div :style="{ transform: `translateY(${stickySection.offset}px)` }">
						<TabSectionHeader v-bind="sectionHeaderBindings(stickySection.section)" />
					</div>
				</div>
				<div class="relative -mb-px w-full" :style="{ height: `${listTotalSize}px` }">
					<div
						v-for="vRow in virtualRows"
						:key="vRow.item.key"
						:ref="measureRow"
						:data-index="vRow.index"
						class="absolute top-0 left-0 w-full"
						:style="{ transform: `translateY(${vRow.start - listOffset}px)` }"
					>
						<TabSectionHeader
							v-if="vRow.item.type === 'header'"
							v-bind="sectionHeaderBindings(vRow.item.section)"
						/>
						<TabListItem
							v-else
							:tab="vRow.item.tab"
							:is-cursor="vRow.index === cursorIndex"
							:is-selected="tabsSelected.has(vRow.item.tab.stableId)"
							:is-duplicate="
								!!vRow.item.tab.url && duplicateUrls.has(vRow.item.tab.url)
							"
							:group-chip="groupChipFor(vRow.item.tab)"
							:windows-map="windowsMap"
							:loaded-groups="loadedGroups"
							@focus="cursorIndex = vRow.index"
							@open="openTab(vRow.item.tab, vRow.index)"
							@toggle-select="toggleSelection(vRow.item.tab)"
							@copy="copyLinks([vRow.item.tab])"
							@close="closeTabs([vRow.item.tab])"
							@create-group="onCreateNewGroup"
						/>
					</div>
				</div>
			</div>

			<!-- Grid view -->
			<div v-else-if="!isListView && sections.length" class="space-y-4">
				<section v-for="section in sections" :key="section.key" class="card overflow-clip">
					<div
						class="sticky z-10"
						:data-row-index="rowIndexByKey.get(section.key)"
						:style="{
							top: `${stickyOffset}px`,
							scrollMarginTop: `${stickyOffset + 16}px`,
							scrollMarginBottom: '96px',
						}"
					>
						<TabSectionHeader v-bind="sectionHeaderBindings(section)" />
					</div>
					<div
						v-if="!isCollapsed(section.key)"
						class="grid gap-3 p-3 pt-5 sm:grid-cols-2 lg:grid-cols-3"
					>
						<TabRow
							v-for="tab in section.tabs"
							:key="`${tab.windowId}-${tab.stableId}`"
							:tab="tab"
							:windows-map="windowsMap"
							:loaded-groups="loadedGroups"
							:tabs-selected="tabsSelected"
							:history="loadedTabHistory"
							:group-color="groupChipFor(tab)?.color"
							:is-cursor="rowIndexByKey.get(tabRowKey(section, tab)) === cursorIndex"
							:data-row-index="rowIndexByKey.get(tabRowKey(section, tab))"
							:style="{
								scrollMarginTop: `${stickyOffset + HEADER_HEIGHT + 16}px`,
								scrollMarginBottom: '96px',
							}"
							@toggle-selection="toggleSelection"
							@open="
								(row) => openTab(row, rowIndexByKey.get(tabRowKey(section, row)))
							"
							@copy="(row) => copyLinks([row])"
							@close="(row) => closeTabs([row])"
							@create-group="onCreateNewGroup"
						/>
					</div>
				</section>
			</div>

			<!-- Empty states -->
			<div v-else class="card">
				<EmptyState
					v-if="searchTerm || activeFilterCount"
					:icon="MagnifyingGlassIcon"
					title="No matching tabs"
				>
					<template v-if="searchTerm">
						Nothing matches “{{ searchTerm }}”{{
							activeFilterCount ? ' with the current filters' : ''
						}}.
					</template>
					<template v-else>No tabs match the current filters.</template>
					<template #actions>
						<AppButton v-if="searchTerm" size="sm" @click="searchTerm = ''">
							Clear search
						</AppButton>
						<AppButton v-if="activeFilterCount" size="sm" @click="clearFilters">
							Clear filters
						</AppButton>
					</template>
				</EmptyState>
				<EmptyState
					v-else
					:icon="RectangleStackIcon"
					title="No tabs to show"
					description="Tabs you open in any window will show up here."
				/>
			</div>
		</div>
	</div>

	<!-- Selection bar -->
	<transition
		enter-active-class="transition duration-150 ease-out"
		enter-from-class="translate-y-2 opacity-0"
		enter-to-class="translate-y-0 opacity-100"
		leave-active-class="transition duration-100 ease-in"
		leave-from-class="translate-y-0 opacity-100"
		leave-to-class="translate-y-2 opacity-0"
	>
		<div
			v-if="tabsSelected.size > 0"
			class="pointer-events-none fixed inset-x-0 bottom-12 z-40 flex justify-center px-4"
		>
			<div
				class="dark:border-vercel-accents-2 pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 dark:bg-black dark:ring-white/5"
			>
				<span
					class="px-2 text-sm font-medium whitespace-nowrap text-slate-900 dark:text-white"
				>
					<span class="tabular-nums">{{ tabsSelected.size }}</span> selected
				</span>
				<AppButton
					intent="ghost"
					size="sm"
					square
					title="Clear selection (Esc)"
					@click="tabsSelected.clear()"
				>
					<span class="sr-only">Clear selection</span>
					<XMarkIcon class="size-4" aria-hidden="true" />
				</AppButton>

				<div
					class="dark:bg-vercel-accents-2 mx-1 h-5 w-px bg-slate-200"
					aria-hidden="true"
				/>

				<TabMoveToMenu
					:tabs="selectedGroup"
					:loaded-groups="loadedGroups"
					:windows-map="windowsMap"
					@on-create-group="
						({ tabs: emitedTabs }) => onCreateNewGroup({ tabs: emitedTabs })
					"
				>
					<template #button-trigger="{ trigger }">
						<button
							:ref="(el) => trigger(el as HTMLElement)"
							type="button"
							:class="button({ intent: 'ghost', size: 'sm' })"
						>
							<ArrowsRightLeftIcon class="size-3.5" aria-hidden="true" />
							Move
						</button>
					</template>
				</TabMoveToMenu>
				<Menu as="div" class="relative">
					<MenuButton :class="button({ intent: 'ghost', size: 'sm' })">
						<RectangleStackIcon class="size-3.5" aria-hidden="true" />
						Context
					</MenuButton>
					<AppMenuItems placement="top" align="left" width="w-60">
						<AppMenuItem :icon="PlusIcon" @click="stashSelectedToNew">
							New context…
						</AppMenuItem>
						<template v-if="peelTargets.length">
							<div class="menu-separator" />
							<p class="menu-heading">Move to context</p>
							<AppMenuItem
								v-for="ctx in peelTargets"
								:key="ctx.id"
								@click="stashSelectedTo(ctx.id)"
							>
								{{ ctx.name }}
								<template #trailing>
									<span
										class="dark:text-vercel-accents-4 text-xs text-slate-400 tabular-nums"
									>
										{{ ctx.tabCount }}
									</span>
								</template>
							</AppMenuItem>
						</template>
					</AppMenuItems>
				</Menu>
				<AppButton intent="ghost" size="sm" @click="saveTargets">
					<BookmarkIcon class="size-3.5" aria-hidden="true" />
					Save
					<kbd class="kbd hidden lg:inline-flex">s</kbd>
				</AppButton>
				<AppButton intent="ghost" size="sm" @click="copyLinks(selectedGroup)">
					<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
					Copy
					<kbd class="kbd hidden lg:inline-flex">yy</kbd>
				</AppButton>

				<div
					class="dark:bg-vercel-accents-2 mx-1 h-5 w-px bg-slate-200"
					aria-hidden="true"
				/>

				<AppButton
					intent="ghost"
					size="sm"
					title="Close every tab that isn't selected (Shift-Del)"
					@click="closeUnSelectedTabs"
				>
					Close others
				</AppButton>
				<AppButton intent="danger-ghost" size="sm" @click="closeSelectedTabs">
					<XMarkIcon class="size-3.5" aria-hidden="true" />
					Close
					<kbd class="kbd hidden lg:inline-flex">dd</kbd>
				</AppButton>
			</div>
		</div>
	</transition>

	<!-- Vim-style statusline -->
	<TabManagerStatusline
		:mode="keymapMode"
		:pending="pendingDisplay"
		:cursor="cursorIndex"
		:total="rows.length"
		:on-header="cursorRow?.type === 'header'"
		:selected-count="tabsSelected.size"
		:category="`by ${groupByLabel.toLowerCase()}`"
		:which-key="whichKey"
		:ctrl="ctrlHeld"
		:ctrl-hints="ctrlHints"
		:ctrl-layer="keymapMode === 'search'"
	/>

	<!-- Keyboard shortcuts help (?) -->
	<KeymapHelpOverlay :open="helpOpen" :bindings="bindings" @close="helpOpen = false">
		<template #footer>
			In the search box, hold <kbd class="kbd">Ctrl</kbd> to use the list keys without leaving
			it:
			<template v-if="isMac">
				<span class="font-mono">Ctrl-x</span> selects,
				<span class="font-mono">Ctrl-z a</span> folds,
				<span class="font-mono">Ctrl-Bksp</span> closes the row under the cursor.
			</template>
			<template v-else>
				<span class="font-mono">Ctrl-Space</span> selects,
				<span class="font-mono">Ctrl-s</span> saves,
				<span class="font-mono">Ctrl-Del</span> closes the row under the cursor.
			</template>
			Hold <kbd class="kbd">Ctrl</kbd> for a moment to see every key.
		</template>
	</KeymapHelpOverlay>
</template>
