import { SaveableTab, WindowsMap } from '@/types'
import { computed, Ref } from 'vue'

type UseChromeTabsArgs = {
	loadedTabs: Ref<SaveableTab[]>
	loadedCurrentWindowId?: number
}
export const useChromeWindowsMap = ({ loadedTabs, loadedCurrentWindowId }: UseChromeTabsArgs) => {
	return computed<WindowsMap>(() => {
		const computedSet = new Set<number>()
		const windowsSet = new Map<number, string>()

		loadedTabs.value.forEach((row) => {
			computedSet.add(row.windowId)
		})

		const arr = [...computedSet]
		arr.forEach((item, index) => {
			const current = loadedCurrentWindowId == item ? ' (Current)' : ''
			windowsSet.set(item, `Window ${index + 1}${current}`)
		})

		return windowsSet
	})
}
