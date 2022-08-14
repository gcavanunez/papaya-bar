import { ChromeTab, Group, HistoryMap, Tab } from '@/types'
import { onMounted, ref } from 'vue'

export const useChromeTabs = () => {
  const loadedTabs = ref<Tab[]>([])
  const loadedTabHistory = ref<HistoryMap>(new Map())
  const loadedGroups = ref<Group[]>([])
  const init = async () => {
    const [tabs, currentWindowId, groups] = await Promise.all([
      new Promise<ChromeTab[]>((resolve) => {
        chrome.tabs.query({}, (tabs) => resolve(tabs))
      }),
      new Promise<number | undefined>((resolve) => {
        chrome.windows.getCurrent({}, ({ id }) => resolve(id))
      }),
      new Promise<Group[]>((resolve) => {
        chrome.tabGroups.query({}, (group) => resolve(group))
      }),
    ])
    // const tabHistoryPromises: Promise<chrome.history.VisitItem[]>[] = []

    loadedTabs.value = tabs.map((row) => ({
      ...row,
      stableId: `stableId-${row.id}`,
    }))
    tabs.forEach((row) => {
      if (row.url) {
        chrome.history.getVisits({ url: row.url }).then((tabHistory) => {
          loadedTabHistory.value.set(row.url!, tabHistory)
        })
        // tabHistoryPromises.push()
        // loadedTabHistory.value.set(row.url, [])
      }
    })

    // const tabHistoryResults = await Promise.all(tabHistoryPromises)
    // tabHistoryResults.forEach((tabHistory) => {
    //   tabHistory
    // })
    loadedGroups.value = groups
  }
  onMounted(() => {
    // To be able to load in dev environment
    if (chrome.tabs) {
      init()
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        init()
      })
      chrome.tabs.onRemoved.addListener((tab, removeInfo) => {
        init()
      })
      chrome.tabs.onMoved.addListener((tabId) => {
        init()
      })
      chrome.tabs.onAttached.addListener((tabId) => {
        init()
      })
    }
  })

  return { loadedTabs, loadedGroups, loadedTabHistory }
}
