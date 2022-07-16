<script setup lang="ts">
import { CollectionIcon } from '@heroicons/vue/solid'
import { onMounted, ref } from 'vue'
type Tab = chrome.tabs.Tab
const loadedTabs = ref<Tab[]>([])

onMounted(() => {
  Promise.all([
    new Promise<Tab[]>((resolve) => {
      chrome.tabs.query({}, (tabs) => resolve(tabs))
    }),
    new Promise<number | undefined>((resolve) => {
      chrome.windows.getCurrent({}, ({ id }) => resolve(id))
    }),
  ]).then(([tabs, currentWindowId]) => {
    loadedTabs.value = tabs
    console.log({ currentWindowId })
  })
})
const openTabs = () => {
  // chrome.extension.
  // const optionsUrl = chrome.extension.getURL('index.html')
  chrome.tabs.create({
    url: 'chrome-extension://' + chrome.runtime.id + '/index.html',
  })
  // chrome.tabs.query({ url: optionsUrl }, function (tabs) {
  //   if (tabs.length) {
  //     if (tabs[0].id) {
  //       chrome.tabs.update(tabs[0].id, { active: true })
  //     }
  //   } else {
  //     chrome.tabs.create({ url: optionsUrl })
  //   }
  // })
  // chrome.tabs.create({ url: optionsUrl })
  // console.log({ optionsUrl })
}
</script>
<template>
  <div class="w-48">
    <ul role="list" class="divide-y divide-gray-200">
      <li class="flex w-full">
        <div class="py-2 px-1 w-full text-left text-slate-700">
          All Tabs - {{ loadedTabs.length }}
        </div>
      </li>
      <li class="flex w-full">
        <button
          @click="openTabs"
          type="button"
          class="w-full flex items-center py-2 px-1 hover:bg-slate-200"
        >
          <CollectionIcon class="h-6 w-6 rounded-full"></CollectionIcon>
          <div class="ml-3">
            <p class="text-sm font-medium text-gray-900">Manage</p>
          </div>
        </button>
      </li>
    </ul>
  </div>
</template>
