/**
 * useSmartGroup — suggest groups for loose tabs, review them (rename, recolor, merge,
 * drop), then apply them as Chrome tab groups in place. Nothing closes, and Undo puts
 * the tabs back where they were. The engines live in lib/smartGroup.
 *
 * "Regroup all" is a fresh regrouping of every tab, grouped ones included: applying it
 * replaces the groups they're in, and Undo brings those groups back.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { pluralize } from '@/lib/format'
import { OPENCODE_KEY, askOpencode, loadConnection, type OpencodeConnection } from '@/lib/opencode'
import { groupWithTools } from '@/lib/opencodeTools'
import {
	downloadOnDeviceModel,
	onDeviceStatus,
	suggestGroups,
	type Engine,
	type OnDeviceStatus,
} from '@/lib/smartGroup'
import {
	GROUP_COLORS,
	groupInPlace,
	pickColors,
	regroupInPlace,
	undoRegroup,
	ungroupTabs,
	type GroupColor,
} from '@/lib/tabGroups'

/**
 * Group loose tabs, or regroup: the tabs leave the groups they're in first (every tab,
 * or a selection holding grouped ones)
 */
export type SmartGroupMode = 'loose' | 'all'

/** What Smart group reads of a tab: the side panel passes Chrome's tabs, the Tabs page its own */
export type SuggestTab = Pick<chrome.tabs.Tab, 'id' | 'title' | 'url' | 'pendingUrl' | 'favIconUrl'>

export interface SuggestOptions {
	engine?: Engine | 'auto'
	usedColors?: string[]
	mode?: SmartGroupMode
}

export type SmartGroup = ReturnType<typeof useSmartGroup>

export interface ReviewTab {
	id: number
	title: string
	url: string
	favIconUrl?: string
}

export interface ReviewGroup {
	key: number
	name: string
	color: GroupColor
	tabs: ReviewTab[]
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function useSmartGroup() {
	const review = ref<ReviewGroup[]>([])
	const engine = ref<Engine | null>(null)
	const fallbackReason = ref('')
	const running = ref(false)
	const progress = ref({ done: 0, total: 0 })
	/** How many tabs the last suggestion looked at */
	const inputCount = ref(0)
	const modelStatus = ref<OnDeviceStatus>('unavailable')
	/** 0–1 while the on-device model downloads, otherwise null */
	const downloadFraction = ref<number | null>(null)
	/** While opencode proposes groups as tool calls: the latest one, and how many so far */
	const live = ref<{ name: string; tabs: number; count: number } | null>(null)
	/** What the running or reviewed suggestion is for */
	const mode = ref<SmartGroupMode>('loose')

	let controller: AbortController | null = null
	let nextKey = 0
	/** The tabs the last suggestion looked at; a regroup takes them all out of their groups */
	let inputIds: number[] = []
	/** The last request, to ask again with another engine */
	let lastRequest: { tabs: SuggestTab[]; options: SuggestOptions } | null = null

	const reviewTabCount = computed(() => review.value.reduce((n, g) => n + g.tabs.length, 0))
	const leftLoose = computed(() => Math.max(0, inputCount.value - reviewTabCount.value))

	/** The paired opencode server, when it's turned on for Smart group */
	const opencode = ref<OpencodeConnection | null>(null)

	async function refreshModelStatus(): Promise<void> {
		const [status, connection] = await Promise.all([onDeviceStatus(), loadConnection()])
		modelStatus.value = status
		opencode.value = connection?.enabled ? connection : null
	}

	// Follow pairing changes made in Settings while this page is open
	function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
		if (area === 'local' && OPENCODE_KEY in changes) void refreshModelStatus()
	}
	onMounted(() => chrome.storage.onChanged.addListener(onStorageChanged))
	onUnmounted(() => chrome.storage.onChanged.removeListener(onStorageChanged))

	async function suggest(tabs: SuggestTab[], options: SuggestOptions = {}): Promise<void> {
		cancel()
		lastRequest = { tabs, options }
		mode.value = options.mode ?? 'loose'
		const byId = new Map<number, ReviewTab>()
		for (const tab of tabs) {
			if (tab.id == null) continue
			byId.set(tab.id, {
				id: tab.id,
				title: tab.title || '',
				url: tab.url || tab.pendingUrl || '',
				favIconUrl: tab.favIconUrl,
			})
		}
		inputIds = [...byId.keys()]
		const own = new AbortController()
		controller = own
		running.value = true
		progress.value = { done: 0, total: byId.size }
		live.value = null
		void refreshModelStatus()
		const connection = opencode.value
		try {
			const result = await suggestGroups([...byId.values()], {
				engine: options.engine,
				signal: own.signal,
				onProgress: (done, total) => (progress.value = { done, total }),
				onGroup: (group, count) => {
					if (controller === own)
						live.value = { name: group.name, tabs: group.tabIds.length, count }
				},
				opencode: connection ? askOpencode(connection) : null,
				// With Papaya's folder set up, the model proposes groups as tool calls
				opencodeTools: connection?.folder
					? (tabs, run) => groupWithTools(tabs, connection, run)
					: null,
				opencodeLimits: connection?.limits,
			})
			if (own.signal.aborted) return
			const colors = pickColors(result.suggestions.length, options.usedColors)
			review.value = result.suggestions.map((suggestion, i) => ({
				key: nextKey++,
				name: suggestion.name,
				color: colors[i],
				tabs: suggestion.tabIds
					.map((id) => byId.get(id))
					.filter((t): t is ReviewTab => !!t),
			}))
			engine.value = result.engine
			fallbackReason.value = result.fallbackReason ?? ''
			inputCount.value = byId.size
			if (!review.value.length) {
				// A model that failed is the news, not the empty fallback
				if (result.fallbackReason) {
					toast.warning("Couldn't group these tabs by topic", {
						description: `${result.fallbackReason}. Grouping by ${result.engine === 'site' ? 'site' : 'the on-device model'} found nothing in common.`,
						duration: 10_000,
					})
				} else toast('No groups found: these tabs have little in common')
			}
		} catch (error) {
			if (!own.signal.aborted) toast.error(`Smart group failed: ${errorMessage(error)}`)
		} finally {
			if (controller === own) {
				controller = null
				running.value = false
				live.value = null
			}
		}
	}

	/** Ask again for the same tabs, with another engine */
	function suggestAgain(preferred: Engine): void {
		if (lastRequest)
			void suggest(lastRequest.tabs, { ...lastRequest.options, engine: preferred })
	}

	function cancel(): void {
		controller?.abort()
		controller = null
		running.value = false
		live.value = null
	}

	function dismiss(): void {
		cancel()
		review.value = []
		engine.value = null
		fallbackReason.value = ''
		mode.value = 'loose'
	}

	function find(key: number): ReviewGroup | undefined {
		return review.value.find((g) => g.key === key)
	}

	function dropGroup(key: number): void {
		review.value = review.value.filter((g) => g.key !== key)
	}

	function dropTab(key: number, tabId: number): void {
		const group = find(key)
		if (!group) return
		group.tabs = group.tabs.filter((t) => t.id !== tabId)
		if (!group.tabs.length) dropGroup(key)
	}

	function mergeInto(fromKey: number, intoKey: number): void {
		const from = find(fromKey)
		const into = find(intoKey)
		if (!from || !into || from === into) return
		into.tabs.push(...from.tabs)
		dropGroup(fromKey)
	}

	function cycleColor(key: number): void {
		const group = find(key)
		if (!group) return
		group.color = GROUP_COLORS[(GROUP_COLORS.indexOf(group.color) + 1) % GROUP_COLORS.length]
	}

	async function apply(): Promise<void> {
		const plans = review.value
			.filter((g) => g.tabs.length)
			.map((g) => ({
				name: g.name.trim() || 'Group',
				color: g.color,
				tabIds: g.tabs.map((t) => t.id),
			}))
		if (!plans.length) return
		if (mode.value === 'all') {
			await applyRegroup(plans)
			return
		}
		const result = await groupInPlace(plans)
		dismiss()
		if (!result.tabIds.length) {
			toast.error('Nothing was grouped: those tabs changed since the suggestion')
			return
		}
		toast(
			`Grouped ${pluralize(result.tabIds.length, 'tab')} into ${pluralize(result.groupIds.length, 'group')}`,
			{
				duration: 10_000,
				action: {
					label: 'Undo',
					onClick: () => void ungroupTabs(result.tabIds, result.positions),
				},
			},
		)
	}

	/**
	 * Regroup every tab the suggestion looked at: they leave their groups, the plans group
	 * them, the rest stay loose. Undo brings the old groups back.
	 */
	async function applyRegroup(plans: { name: string; color: string; tabIds: number[] }[]) {
		const result = await regroupInPlace(plans, inputIds)
		dismiss()
		if (!result.tabIds.length) {
			// Nothing took: put the groups back rather than leave every tab loose
			await undoRegroup(result)
			toast.error('Nothing was regrouped: those tabs changed since the suggestion', {
				description: 'Your groups are as they were.',
			})
			return
		}
		const loose = result.involved.length - result.tabIds.length
		toast(
			`Regrouped ${pluralize(result.tabIds.length, 'tab')} into ${pluralize(result.groupIds.length, 'group')}`,
			{
				description: loose
					? `${pluralize(loose, 'tab')} fit no group and ${loose === 1 ? 'is' : 'are'} loose now.`
					: undefined,
				duration: 15_000,
				action: { label: 'Undo', onClick: () => void undoRegroup(result) },
			},
		)
	}

	/** Start the one-time download of Chrome's on-device model (call from a click). */
	async function download(): Promise<void> {
		downloadFraction.value = 0
		try {
			await downloadOnDeviceModel((fraction) => (downloadFraction.value = fraction))
			await refreshModelStatus()
			toast('On-device model ready: Smart group now groups by topic')
		} catch (error) {
			toast.error(`Couldn't download the model: ${errorMessage(error)}`)
		} finally {
			downloadFraction.value = null
		}
	}

	return {
		review,
		engine,
		fallbackReason,
		running,
		progress,
		leftLoose,
		reviewTabCount,
		modelStatus,
		downloadFraction,
		live,
		mode,
		suggestAgain,
		refreshModelStatus,
		opencode,
		suggest,
		cancel,
		dismiss,
		dropGroup,
		dropTab,
		mergeInto,
		cycleColor,
		apply,
		download,
	}
}
