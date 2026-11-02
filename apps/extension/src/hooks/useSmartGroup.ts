/**
 * useSmartGroup — suggest groups for loose tabs, review them (rename, recolor, merge,
 * drop), then apply them as Chrome tab groups in place. Nothing closes, and Undo puts
 * the tabs back where they were. The engines live in lib/smartGroup.
 */
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { pluralize } from '@/lib/format'
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
	ungroupTabs,
	type GroupColor,
} from '@/lib/tabGroups'

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

	let controller: AbortController | null = null
	let nextKey = 0

	const reviewTabCount = computed(() => review.value.reduce((n, g) => n + g.tabs.length, 0))
	const leftLoose = computed(() => Math.max(0, inputCount.value - reviewTabCount.value))

	async function refreshModelStatus(): Promise<void> {
		modelStatus.value = await onDeviceStatus()
	}

	async function suggest(
		tabs: chrome.tabs.Tab[],
		options: { engine?: Engine | 'auto'; usedColors?: string[] } = {},
	): Promise<void> {
		cancel()
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
		const own = new AbortController()
		controller = own
		running.value = true
		progress.value = { done: 0, total: byId.size }
		void refreshModelStatus()
		try {
			const result = await suggestGroups([...byId.values()], {
				engine: options.engine,
				signal: own.signal,
				onProgress: (done, total) => (progress.value = { done, total }),
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
			if (!review.value.length) toast('No groups found: these tabs have little in common')
		} catch (error) {
			if (!own.signal.aborted) toast.error(`Smart group failed: ${errorMessage(error)}`)
		} finally {
			if (controller === own) {
				controller = null
				running.value = false
			}
		}
	}

	function cancel(): void {
		controller?.abort()
		controller = null
		running.value = false
	}

	function dismiss(): void {
		cancel()
		review.value = []
		engine.value = null
		fallbackReason.value = ''
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
		refreshModelStatus,
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
