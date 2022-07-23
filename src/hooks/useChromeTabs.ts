import { ChromeTab, Group, Tab } from '@/types'
import { onMounted, ref } from 'vue'

export const useChromeTabs = () => {
  const loadedTabs = ref<Tab[]>([])
  const loadedGroups = ref<Group[]>([])
  const init = () => {
    Promise.all([
      new Promise<ChromeTab[]>((resolve) => {
        chrome.tabs.query({}, (tabs) => resolve(tabs))
      }),
      new Promise<number | undefined>((resolve) => {
        chrome.windows.getCurrent({}, ({ id }) => resolve(id))
      }),
      new Promise<Group[]>((resolve) => {
        chrome.tabGroups.query({}, (group) => resolve(group))
      }),
    ]).then(([tabs, currentWindowId, groups]) => {
      loadedTabs.value = tabs.map((row) => ({
        ...row,
        stableId: `stableId-${row.id}`,
      }))
      loadedGroups.value = groups
    })
  }
  onMounted(() => {
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

  return { loadedTabs, loadedGroups }
}
