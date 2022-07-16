import { Tab } from './types'
import { copyToClipboard } from './utils'

export const moveTabTo = (tabs: Tab[], windowId: number) => {
  tabs.forEach((row) => {
    if (row.id) {
      chrome.tabs.move(row.id, {
        index: -1,
        windowId: windowId,
      })
    }
  })
}

export const copyLink = (tab: Tab) => {
  const text = `${tab.title}\n${tab.url}`
  copyToClipboard(text)
}

export const closeTab = (tab: Tab) => {
  if (tab.id) {
    chrome.tabs.remove(tab.id)
  }
}

export const goTo = (tab: Tab) => {
  if (tab.id) {
    chrome.windows.update(tab.windowId, { focused: true })
    chrome.tabs.update(tab.id, { active: true })
    // chrome.tabs.get(tab.id, function (onTab) {
    //   chrome.tabs.highlight({ tabs: onTab.index }, function () {})
    // })
  }
}
