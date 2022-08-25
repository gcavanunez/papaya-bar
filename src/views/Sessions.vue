<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import AppBtn from '@/components/AppBtn.vue'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { format } from 'date-fns'
type SavedSession = {
	url?: string
	title?: string
	favicon?: string
	windowId?: number
	stableId: string
}
type SavedWindow = {
	width?: number
	left?: number
	height?: number
	top?: number
	id?: number
}
type SavedData = {
	tabs: SavedSession[]
	windows: SavedWindow[]
}

const state = useStorage('sessions:saved', new Map<string, SavedData>())
const { loadedTabs } = useChromeTabs()
const storeSession = async () => {
	const windowSet = new Set<number>()
	const toStore: SavedSession[] = loadedTabs.value.map((tab) => {
		if (tab.windowId) {
			windowSet.add(tab.windowId)
		}
		return {
			url: tab.url,
			title: tab.title,
			favicon: tab.favIconUrl,
			stableId: tab.stableId,
			windowId: tab.windowId,
		}
	})
	console.log({ windowSet })
	const windows = await chrome.windows.getAll()
	const storedWindows = windows.map((queriedWindow) => {
		const { width, left, height, top, id } = queriedWindow
		return {
			width,
			left,
			height,
			top,
			id,
		}
	})
	state.value.set(format(new Date(), 'hh:mm aaa MM/dd/yyyy'), {
		tabs: toStore,
		windows: storedWindows,
	})
}
// function groupBy<T>(xs:T[], key:string) {

//   return xs.reduce((rv, x)=>{
//     // @ts-check
//     // eslint-disable-next-line no-extra-semi
//     // ;
//     (rv[x[key]] = rv[x[key]] || []).push(x)
//     return rv
//   }, {}as Record<string, T>)
// }
const openAll = async ({ tabs, windows: savedWindows }: SavedData) => {
	console.log({ tabs })
	const group = [...tabs].reduce((acc, curr) => {
		if (curr.windowId) {
			const data = acc.get(curr.windowId) || []
			acc.set(curr.windowId, [...data, curr])
		}
		return acc
	}, new Map<number, SavedSession[]>())

	// const windowsSaved =
	let windowLookUp = new Map<number, SavedWindow>()
	savedWindows.forEach((row) => {
		// return [row.id!, row]
		windowLookUp.set(row.id!, row)
	})
	/**
	 * 1. group by fake windowId
	 * 2. on first create a new window then use same id for the rest of tabs
	 */

	const windoPromises = [...group.entries()].map(([id, value]) => {
		// entiores url>
		// return chrome.windows.create({width,left,height,top,url})
		const { height, left, top, width } = windowLookUp.get(id)!

		return chrome.windows.create({ height, left, top, width, url: value[0].url })
	})
	const windows = await Promise.all(windoPromises)

	windows.forEach((newChromeWindow, index) => {
		const lilGroup = [...group.entries()][index][1]
		// omit 0 url
		lilGroup.forEach((row, index) => {
			if (index === 0) return
			chrome.tabs.create({
				url: row.url,
				windowId: newChromeWindow.id,
			})
		})
	})
}
const removeSavedSession = (key: string) => {
	state.value.delete(key)
}
</script>
<template>
	<div class="relative bg-slate-100">
		<div class="container mx-auto max-w-5xl py-6 px-4 sm:px-2">
			<AppBtn @click="storeSession">Save session</AppBtn>
			<ul class="mt-6 rounded-lg bg-white shadow-md">
				<li v-for="[key, value] in state.entries()" :key="key">
					<div class="flex justify-between px-4 py-4 md:px-6">
						<div>{{ key }}: {{ value.tabs.length }}</div>
						<div class="space-x-2">
							<AppBtn @click="openAll(value)">Open session</AppBtn>
							<AppBtn @click="removeSavedSession(key)">Remove session</AppBtn>
						</div>
					</div>
				</li>
			</ul>
		</div>
	</div>
</template>
