import { useStorage } from '@vueuse/core'
import { format } from 'date-fns'
import { Tab, Group, SaveableTab } from '@/types'

type ChromeTab = chrome.tabs.Tab
const asyncGetTab = (tabId: number) =>
	new Promise<ChromeTab>((resolve) => {
		chrome.tabs.get(tabId, (tab) => resolve(tab))
	})
const areRectanglesOverlap = (rect1: number[], rect2: number[]) => {
	const [left1, top1, right1, bottom1] = [rect1[0], rect1[1], rect1[2], rect1[3]],
		[left2, top2, right2, bottom2] = [rect2[0], rect2[1], rect2[2], rect2[3]]
	// The first rectangle is under the second or vice versa
	if (top1 <= bottom2 || top2 <= bottom1) {
		return false
	}
	// The first rectangle is to the left of the second or vice versa
	if (right1 <= left2 || right2 <= left1) {
		return false
	}
	// Rectangles overlap
	return true
}

export type SavedSession = SaveableTab
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
export type SavedData = {
	title: string
	description: string
	tabs: SaveableTab[]
	groups: Group[]
	windows: SavedWindow[]
	displays: SavedDisplay[]
}

const state = useStorage('sessions:saved', new Map<string, SavedData>())

export const useSessionsData = () => {
	const storeSession = async (tabs: Tab[]) => {
		const toStore: SavedSession[] = tabs.map((tab) => {
			return {
				id: tab.id,
				active: tab.active,
				url: tab.url,
				title: tab.title,
				favIconUrl: tab.favIconUrl,
				stableId: tab.stableId,
				windowId: tab.windowId,
				groupId: tab.groupId,
			}
		})
		let displays: SavedDisplay[] = []
		chrome.system.display.getInfo((display) => {
			// NOTE: Get current display size
			// const { width, height } = display[0].bounds
			// console.log({ display:display.map(row=>row.) })
			// displays.push(display)

			displays = display.map(({ bounds: { height, left, top, width } }) => ({
				height,
				left,
				top,
				width,
			}))

			// chrome.windows.create({
			// 	url: 'https://google.com',
			// 	type: 'popup',
			// 	width,
			// 	height,
			// })
		})
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
		const groups = await new Promise<Group[]>((resolve) => {
			chrome.tabGroups.query({}, (group) => resolve(group))
		})

		const relvantGroups = new Set<number>()

		toStore.forEach((row) => {
			if (row.groupId) {
				relvantGroups.add(row.groupId)
			}
		})
		const description = groups
			.filter((row) => relvantGroups.has(row.id))
			.map((row) => row.title)
			.join(', ')
		// groups.map(({color,id,windowId,title,collapsed})=>{return{color,}})
		state.value.set(format(new Date(), 'hh:mm aaa MM/dd/yyyy'), {
			tabs: toStore,
			windows: storedWindows,
			groups: groups,
			displays,
			description: '',
			title: description,
		})
	}
	const openAll = async ({
		tabs,
		windows: savedWindows,
		groups: savedGroups,
		displays,
	}: SavedData) => {
		const loadDisplays: SavedDisplay[] = await new Promise((resolve) => {
			chrome.system.display.getInfo((display) => {
				resolve(
					display.map(({ bounds: { height, left, top, width }, id, name, rotation }) => {
						console.log('exta info that might help:', {
							id,
							name,
							rotation,
						})
						return { height, left, top, width }
					}),
				)
			})
		})
		console.log({ tabs })
		console.log({ savedWindows })
		console.log({ savedGroups })
		console.log({ displays })

		// This does not work since
		//  We could have a tabs not populate new windows
		//  But we are matching to previous paradigm of all windows
		// We rather need to just group by the tabs to diff valid groups
		//  Tabs => filter groupd id => group by groupd _id vs grouping by windows, since we later might not have those windows
		const groupMap = new Map<number, Group>()
		savedGroups.forEach((row) => {
			groupMap.set(row.id, row)
		})
		const groupedByGroups = tabs.reduce((acc, curr) => {
			if (curr.groupId) {
				const data = groupMap.get(curr.groupId)
				if (data) {
					const alreadyGrouped = acc.get(curr.groupId) || {
						group: data,
						tabs: [],
					}
					acc.set(curr.groupId, {
						group: alreadyGrouped.group,
						tabs: [...alreadyGrouped.tabs, curr],
					})
				}
			}
			return acc
			// group id, {group info and tabs}
		}, new Map<number, { group: Group; tabs: SavedSession[] }>())

		const groupedTabs = tabs.reduce((acc, curr) => {
			if (curr.windowId) {
				const data = acc.get(curr.windowId) || []
				acc.set(curr.windowId, [...data, curr])
				// const data = acc.get(curr.windowId) || { tabs: [], groups: [] }
				// acc.set(curr.windowId, { tabs: [...data.tabs, curr], groups: [...data.groups] })
			}
			return acc
		}, new Map<number, SavedSession[]>())

		// const windowsSaved =
		const windowLookUp = new Map<number, SavedWindow>()
		savedWindows.forEach((row) => {
			// return [row.id!, row]
			windowLookUp.set(row.id!, row)
		})
		console.log({ windowLookUp })
		/**
		 * 1. group by fake windowId
		 * 2. on first create a new window then use same id for the rest of tabs
		 */
		const shouldBeLaterGroupedTabs = new Map<number, SavedSession[]>()
		const windoPromises = [...groupedTabs.entries()].map(([id, value]) => {
			// entiores url>
			// return chrome.windows.create({width,left,height,top,url})
			const { height, left, top, width } = windowLookUp.get(id)!
			const firstTabInWindow = value[0]
			if (firstTabInWindow.groupId) {
				shouldBeLaterGroupedTabs.set(firstTabInWindow.groupId, [firstTabInWindow])
			}
			const isTopNegative = top! < 0
			const newHeight = isTopNegative ? height! * -1 : height!
			const newWidth = width! + left!
			const windowCoordinates = [left!, newHeight, newWidth, top!]

			const fits = loadDisplays.some((row) => {
				console.log(
					'is rectangle overlaping? ',
					areRectanglesOverlap(
						[row.left, row.height, row.width, row.top],
						windowCoordinates,
					),
				)
				return areRectanglesOverlap(
					[row.left, row.height, row.width, row.top],
					windowCoordinates,
				)
			})

			const matchingDisplay = displays.find((row) => {
				return areRectanglesOverlap(
					[row.left, row.height, row.width, row.top],
					windowCoordinates,
				)
			})

			console.log({ loadDisplays })
			console.log({ matchingDisplay })
			if (fits) {
				return chrome.windows.create({
					height,
					left,
					top,
					width,
					url: firstTabInWindow.url,
				})
			}
			// this works since we are scaling, though not proportiallyy valid, its good enough?
			const scale = Math.min(loadDisplays[0].width / width!, loadDisplays[0].height / height!)
			const trueHeight = Math.round(scale * height!)
			const trueWidth = Math.round(scale * width!)

			// const topx = loadDisplays[0].left + (left! - loadDisplays[0].left) * scale
			// const topy = loadDisplays[0].top + (top! - loadDisplays[0].top) * scale

			const topx = Math.round(left! * scale)
			// height always positive, since actual height of the window
			// top can be negative and will mark the point at which it starts, but its actually relative to the window at which it was saved
			const newTopY = height! + top!
			const shoutBeY = Math.round(newTopY * scale)
			const topy = shoutBeY >= 0 ? shoutBeY : shoutBeY * -1

			console.log({ trueHeight, trueWidth })
			console.log('og?', { left, top })
			console.log('maybe?', { topx, topy })
			return chrome.windows.create({
				height: trueHeight,
				// left: loadDisplays[0].left,
				// top: loadDisplays[0].top,
				left: topx,
				top: topy,
				width: trueWidth,
				url: firstTabInWindow.url,
			})
		})
		const windows = await Promise.all(windoPromises)

		const coolWindowData = windows.map((newChromeWindow, index) => {
			const lilTabGroup = [...groupedTabs.entries()][index][1]
			// this is wrong
			// const lilGroups = [...groupedByGroups.entries()][index][1]
			console.log({ new_tabs: newChromeWindow.tabs })
			return {
				newChromeWindow,
				alreadyOpenedTabs: newChromeWindow.tabs || [],
				tabs: lilTabGroup.map((row) => ({
					...row,
					newWindowId: newChromeWindow.id,
				})),
				// groups: lilGroups.map((row) => ({ ...row, newWindowId: newChromeWindow.id })),
			}
		})
		console.log({ coolWindowData })

		const createdTabs = await Promise.all(
			coolWindowData.flatMap((row) => {
				// return row.tabs.map()
				return row.tabs
					.filter((row, index) => index !== 0)
					.map((row) => {
						// if (lilTabGroupIndex === 0)
						if (row.groupId) {
							const alreadyGroupedTabs =
								shouldBeLaterGroupedTabs.get(row.groupId) || []
							shouldBeLaterGroupedTabs.set(row.groupId, [...alreadyGroupedTabs, row])
						}
						// return {
						// 	url: row.url,
						// 	windowId: row.newWindowId,
						// }
						return chrome.tabs.create({
							url: row.url,
							windowId: row.newWindowId,
						})
					})
			}),
			// .map((row) => {
			// 	if (!row) {
			// 		return
			// 	}
			// 	console.log('about to create', { row })
			// 	return chrome.tabs.create({
			// 		url: row.url,
			// 		windowId: row.windowId,
			// 	})
			// })
		)

		console.log({ createdTabs })
		const upgradedSet = new Map<string, ChromeTab>()
		const addBackIn = [
			...createdTabs,
			...coolWindowData.flatMap(({ alreadyOpenedTabs }) => alreadyOpenedTabs),
		]
		addBackIn.forEach((row) => {
			if (row.status == 'loading') {
				if (row?.pendingUrl && row?.id) {
					upgradedSet.set(row?.pendingUrl, row)
				}
			}
			if (row.status == 'complete') {
				if (row?.url && row?.id) {
					upgradedSet.set(row?.url, row)
				}
			}
		})
		console.log({ upgradedSet })
		// omit 0 url
		console.log({ coolWindowData })
		// coolWindowData.forEach(({ groups: lilGroups, newChromeWindow }) => {
		// 	console.log({ id: newChromeWindow.id })

		// })

		groupedByGroups.forEach((lilGroup) => {
			const groupableTabs = shouldBeLaterGroupedTabs.get(lilGroup.group.id)
			console.log({ groupableTabs })
			if (groupableTabs) {
				const groupableTabsSet = new Set<string>()
				groupableTabs.forEach((row) => {
					if (row.url) {
						groupableTabsSet.add(row.url)
					}
				})

				console.log({ groupableTabsSet })

				const actualTabs = [...upgradedSet]
					.filter(([key]) => groupableTabsSet.has(key))
					.map(([, row]) => row)
				const tabIds = actualTabs.map((row) => row.id!)

				console.log({ tabIds })

				if (tabIds.length > 0) {
					console.log({ id_match: actualTabs[0] })
					chrome.tabs
						.group({
							createProperties: {
								windowId: actualTabs[0].windowId,
							},
							tabIds,
						})
						.then((group) => {
							chrome.tabGroups.update(group, {
								collapsed: lilGroup.group.collapsed,
								color: lilGroup.group.color,
								title: lilGroup.group.title,
							})
						})
				}
			}
		})
	}
	const removeSavedSession = (key: string) => {
		state.value.delete(key)
	}
	const downloadSavedSession = (key: string, session: SavedData) => {
		const json = JSON.stringify(session)

		const a = document.createElement('a')
		a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
		a.download = 'myFile.json'
		a.click()
		a.remove()
	}
	const findByUid = (uid: string) => {
		return state.value.get(uid)
	}
	const saveByUid = (uid: string, newData: Partial<SavedData>) => {
		const session = state.value.get(uid)
		if (session) {
			state.value.set(uid, { ...session, ...newData })
		}
	}
	return {
		state,
		findByUid,
		saveByUid,
		storeSession,
		openAll,
		removeSavedSession,
		downloadSavedSession,
	}
}
