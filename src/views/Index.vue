<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import { XIcon, ChevronDownIcon } from '@heroicons/vue/solid'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { TabGroup, TabList, Tab as AppTab } from '@headlessui/vue'
import { ChevronUpIcon } from '@heroicons/vue/solid'
import { copyToClipboard } from '../utils'
import AppBtn from '@/components/AppBtn.vue'
import { Tab, ChromeTab, Group, Grouped } from '@/types'
import { closeTab, moveTabTo } from '@/helpers'
import TabRow from '@/components/TabRow.vue'
import { useChromeTabs } from '@/hooks/useChromeTabs'
import autoAnimate from '@formkit/auto-animate'

const groupContainer = ref<HTMLElement | null>(null)
const groupHeaders = ref<HTMLElement | null>(null)
onMounted(() => {
  if (groupContainer.value) {
    autoAnimate(groupContainer.value, { duration: 150 }) // thats it!
  }
  if (groupHeaders.value) {
    autoAnimate(groupHeaders.value, { duration: 150 }) // thats it!
  }
})
const changeTab = (index: number) => {
  selectedTab.value = index
}
const selectedTab = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const focusOnInput = () => {
  if (inputRef.value) {
    inputRef.value.focus()
  }
}
onMounted(() => {
  watchEffect((onInvalidate) => {
    const focusSearch = (e: KeyboardEvent) => {
      // if (75 === e.which && (e.ctrlKey || e.metaKey)) {
      //   e.preventDefault()
      //   focusOnInput()
      // }
      if (e.key == '/' && document.activeElement !== inputRef.value) {
        console.log('focusSearch hi')
        e.preventDefault()
        focusOnInput()
      }
      // var n = e.target || e.srcElement,
      //   r = n.tagName
      // n.isContentEditable ||
      //   'INPUT' === r ||
      //   'SELECT' === r ||
      //   'TEXTAREA' === r ||
      //   (191 === e.which && (e.preventDefault(), open()))
    }
    document.addEventListener('keydown', focusSearch)
    onInvalidate(() => {
      document.removeEventListener('keydown', focusSearch)
    })
  })
})
const categories = ref({
  All: [],
  Grouped: [],
  Windows: [],
  Current: [],
})
// chrome.tabs
const searchTerm = ref<string>('')
const { loadedTabs, loadedGroups, loadedTabHistory } = useChromeTabs()
const tabsSelected = ref<Set<string>>(new Set())
const groupMap = computed(() => {
  let computedMap = new Map()
  loadedGroups.value.forEach((row) => {
    computedMap.set(row.id, row.title)
  })
  return computedMap
})

const windowsMap = computed(() => {
  let computedSet = new Set<number>()

  loadedTabs.value.forEach((row) => {
    computedSet.add(row.windowId)
  })

  const windowsSet = new Map<number, string>()
  const arr = [...computedSet]
  arr.forEach((item, index) => {
    windowsSet.set(item, `Window ${index + 1}`)
  })

  return windowsSet
})
const selectedGroup = computed(() => {
  return loadedTabs.value.filter((row) => tabsSelected.value.has(row.stableId))
})
// The Logic
const grouped = computed<Grouped>(() => {
  const based = loadedTabs.value.reduce((acc, curr) => {
    if (selectedTab.value === 0) {
      if (!curr.url) {
        return acc
      }
      const domain = new URL(curr.url).hostname
      if (acc[domain]) {
        return { ...acc, [domain]: [...acc[domain], curr] }
      }
      return {
        ...acc,
        [domain]: [curr],
      }
    }
    if (selectedTab.value === 1) {
      // other case
      if (!curr.groupId) {
        return acc
      }

      const domain =
        curr.groupId !== -1 ? groupMap.value.get(curr.groupId) : 'other'

      if (acc[domain]) {
        return { ...acc, [domain]: [...acc[domain], curr] }
      }
      return {
        ...acc,
        [domain]: [curr],
      }
    }
    // other case
    // if (!curr.windowId) {
    //   return acc
    // }

    // const domain =
    //   curr.groupId !== -1 ? groupMap.value.get(curr.groupId) : 'other'
    // const domain = `${curr.windowId}` windowsMap.value
    const windowName = windowsMap.value.get(curr.windowId)
    const domain = windowName ? windowName : 'Other'
    if (acc[domain]) {
      return { ...acc, [domain]: [...acc[domain], curr] }
    }
    return {
      ...acc,
      [domain]: [curr],
    }
  }, {} as Grouped)

  const actualGroup = Object.entries(based).reduce((acc, [index, values]) => {
    let checkedValues = values.filter((row) => {
      if (!row.title || !row.url) {
        return false
      }
      return (
        row.title
          .toLocaleLowerCase()
          .indexOf(searchTerm.value.toLocaleLowerCase()) > -1 ||
        row.url
          .toLocaleLowerCase()
          .indexOf(searchTerm.value.toLocaleLowerCase()) > -1
      )
    })
    if (checkedValues.length > 1) {
      return { ...acc, [index]: checkedValues }
    }
    if (acc['other']) {
      return { ...acc, ['other']: [...acc['other'], ...checkedValues] }
    }
    return { ...acc, ['other']: [...checkedValues] }
  }, {} as Grouped)
  if (selectedTab.value === 0) {
    return actualGroup
  }
  return Object.keys(actualGroup)
    .sort()
    .reduce((obj, key) => {
      obj[key] = actualGroup[key]
      return obj
    }, {} as Grouped)
})
const totalTabs = computed(() => {
  return Object.values(grouped.value)
    .flatMap((row) => row.length)
    .reduce((acc, curr) => {
      return acc + curr
    }, 0)
})

const closeTabs = (tabs: Tab[]) => {
  tabs.forEach((row) => {
    closeTab(row)
  })
}
const moveTabs = async (tabs: Tab[]) => {
  const newWindow = await chrome.windows.create()
  tabs.forEach((row) => {
    if (row.id) {
      chrome.tabs.move(row.id, {
        index: -1,
        windowId: newWindow.id,
      })
    }
  })
}
const copyLinks = (tabs: Tab[]) => {
  const urls = tabs
    .map((row) => [row.url, row.title])
    .reduce((acc, curr) => {
      return `${acc}\n\n${curr[1]}\n${curr[0]}`
    }, '')
  if (urls) {
    copyToClipboard(urls)
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
const closeDuplicates = () => {
  const duplicates = loadedTabs.value.filter(
    (item, index, allTabs) =>
      allTabs.findIndex((withIn) => withIn.url === item.url) != index,
  )
  duplicates.forEach(closeTab)
}
</script>

<template>
  <div class="relative bg-slate-100">
    <header
      class="firefox:bg-opacity-90 sticky top-0 z-30 flex h-[72px] items-center bg-slate-100 bg-opacity-50 backdrop-blur backdrop-filter"
    >
      <div
        class="container mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-2"
      >
        <div class="">
          <router-link :to="{ name: 'index', hash: `#head` }">
            <h1 class="text-2xl text-slate-700">
              All Tabs - {{ loadedTabs.length }}
            </h1>
          </router-link>
        </div>
        <div
          class="flex w-full max-w-3xl justify-end divide-x divide-slate-300"
        >
          <div class="flex w-full max-w-md flex-shrink items-center px-4">
            <label for="search" class="sr-only">Search tabs</label>
            <div class="relative w-full">
              <input
                type="text"
                ref="inputRef"
                id="search"
                v-model="searchTerm"
                class="peer block w-full rounded-md border-slate-300 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
                placeholder="Search"
              />
              <div
                class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 peer-focus:hidden"
              >
                <p
                  class="inline-flex items-center rounded border border-gray-200 px-2 py-0.5 font-sans text-xs font-medium text-gray-400"
                >
                  /
                </p>
              </div>
              <div
                v-if="totalTabs > 0 && searchTerm"
                class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
              >
                <div class="flex">
                  <p
                    class="inline-flex items-center rounded-l border border-r-0 border-gray-200 px-2 py-0.5 font-sans text-xs font-medium text-gray-400"
                  >
                    {{ totalTabs }}
                  </p>
                  <button
                    @click="searchTerm = ''"
                    class="pointer-events-auto rounded-r border border-gray-200 bg-slate-50 px-2 py-0.5 text-gray-400"
                  >
                    <XIcon class="h-3 w-3 fill-current" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="w-full max-w-md flex-grow px-4">
            <TabGroup @change="changeTab" :selectedIndex="selectedTab">
              <TabList class="flex space-x-1 rounded-lg bg-blue-900/20 p-1">
                <AppTab
                  v-for="category in Object.keys(categories)"
                  as="template"
                  :key="category"
                  v-slot="{ selected }"
                >
                  <button
                    :class="[
                      'w-full rounded-md py-2 px-3 text-sm font-medium leading-5 text-blue-700',
                      'ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus-visible:ring-2',
                      selected
                        ? 'bg-white shadow'
                        : 'text-blue-50 hover:bg-white/[0.12] hover:text-white',
                    ]"
                  >
                    {{ category }}
                  </button>
                </AppTab>
              </TabList>
            </TabGroup>
          </div>
        </div>
      </div>
    </header>
    <div class="container mx-auto max-w-5xl py-6 px-4 sm:px-2" id="head">
      <div class="grid grid-cols-3 gap-6">
        <div>
          <ul
            ref="groupHeaders"
            role="list"
            class="space-y-6 pl-2 text-sm leading-6 text-slate-700 lg:sticky lg:top-0 lg:-mt-16 lg:h-screen lg:w-72 lg:overflow-y-auto lg:py-16 lg:pr-8 lg:[mask-image:linear-gradient(to_bottom,transparent,white_4rem,white)]"
          >
            <li>
              <div class="rounded-lg bg-white shadow-md">
                <div class="px-4 py-4 md:px-6">
                  <AppBtn @click="closeDuplicates"> Close duplicates </AppBtn>
                </div>
              </div>
            </li>
            <li v-for="(group, index) in grouped" :key="`list-${index}`">
              <Disclosure v-slot="{ open }">
                <DisclosureButton
                  class="flex w-full items-center justify-between space-x-2 rounded-lg bg-blue-100 px-4 py-2 text-left text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75"
                >
                  <router-link
                    :to="{ name: 'index', hash: `#section-${index}` }"
                    class="inline-flex w-full justify-between font-semibold text-slate-900"
                  >
                    <div>{{ index }}</div>
                    <div
                      class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm"
                    >
                      {{ group.length }}
                    </div>
                  </router-link>
                  <ChevronUpIcon
                    :class="open ? 'rotate-180 transform' : ''"
                    class="h-5 w-5 text-blue-500"
                  />
                </DisclosureButton>
                <DisclosurePanel class="px-4 text-sm text-slate-500">
                  <ul
                    role="list"
                    class="mt-2 space-y-4 border-l border-slate-200 pl-6"
                  >
                    <li>
                      <button @click="moveTabs(group)">
                        Move to new window
                      </button>
                    </li>
                    <li>
                      <button @click="closeTabs(group)">Close all</button>
                    </li>
                    <li>
                      <button @click="copyLinks(group)">Copy all links</button>
                    </li>
                  </ul>
                </DisclosurePanel>
              </Disclosure>
            </li>
          </ul>
        </div>
        <div class="col-span-2 space-y-6" ref="groupContainer">
          <div
            class="divide-y divide-slate-100 rounded-lg bg-white shadow-md"
            v-for="(group, index) in grouped"
            :key="`section-${index}`"
            :id="`section-${index}`"
          >
            <div class="px-4 py-4 md:px-6">
              <h2 class="sr-only">{{ index }}</h2>
              <div class="flex items-center justify-between">
                <AppBtn>
                  {{ index }}
                </AppBtn>
                <div class="flex items-center space-x-2">
                  <AppBtn @click="selectGroup(group)" type="button">
                    Select
                  </AppBtn>
                  <AppBtn @click="copyLinks(group)" type="button">
                    Copy
                  </AppBtn>
                  <AppBtn
                    @click="closeTabs(group)"
                    type="button"
                    color="round-primary"
                  >
                    <XIcon class="h-3 w-3" />
                  </AppBtn>
                </div>
              </div>
            </div>
            <ul class="px-4 py-4 md:px-6">
              <TabRow
                v-for="tab in group"
                :key="`${tab.windowId}-${tab.index}`"
                :tab="tab"
                :tabs-selected="tabsSelected"
                :windows-map="windowsMap"
                :history="loadedTabHistory"
                @toggle-selection="toggleSelection"
              />
            </ul>
          </div>
        </div>
      </div>
    </div>
    <footer
      v-if="[...tabsSelected].length > 0"
      class="sticky bottom-0 left-0 right-0 z-10 w-full bg-slate-900 shadow-lg"
    >
      <div class="mx-auto w-full max-w-7xl px-4 sm:px-2">
        <div
          class="flex w-full items-center justify-between rounded-lg px-4 py-4 text-lg md:px-6"
        >
          <div class="text-slate-300">
            {{ [...tabsSelected].length }} Tabs selected
          </div>
          <div class="flex items-center space-x-2">
            <AppBtn
              @click="closeTabs(selectedGroup)"
              type="button"
              color="primary-dark"
            >
              Close all
            </AppBtn>
            <Menu
              as="div"
              class="pointer-events-auto relative inline-flex text-left"
            >
              <MenuButton as="template">
                <AppBtn color="primary-dark">
                  Move to
                  <ChevronDownIcon
                    class="ml-2 -mr-1 h-3 w-3 text-slate-200"
                    aria-hidden="true"
                  />
                </AppBtn>
              </MenuButton>

              <transition
                enter-active-class="transition duration-100 ease-out"
                enter-from-class="transform scale-95 opacity-0"
                enter-to-class="transform scale-100 opacity-100"
                leave-active-class="transition duration-75 ease-in"
                leave-from-class="transform scale-100 opacity-100"
                leave-to-class="transform scale-95 opacity-0"
              >
                <MenuItems
                  class="absolute right-0 bottom-0 z-10 mt-2 w-56 origin-bottom-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
                >
                  <div class="px-1 py-1">
                    <MenuItem
                      v-slot="{ active, disabled }"
                      :key="`${windowId}-custom-selected`"
                      v-for="[windowId, value] in [...windowsMap]"
                      @click="moveTabTo(selectedGroup, windowId)"
                    >
                      <button
                        :class="[
                          active ? 'bg-blue-500 text-white' : 'text-slate-700',
                          'group flex w-full items-center rounded-md px-2 py-2 text-sm',
                          disabled ? 'opacity-50' : 'opacity-100',
                        ]"
                      >
                        {{ value }}
                      </button>
                    </MenuItem>
                  </div>
                </MenuItems>
              </transition>
            </Menu>
            <AppBtn
              @click="moveTabs(selectedGroup)"
              color="primary-dark"
              type="button"
            >
              Move
            </AppBtn>
            <AppBtn
              @click="copyLinks(selectedGroup)"
              color="primary-dark"
              type="button"
            >
              Copy
            </AppBtn>
            <AppBtn
              @click="tabsSelected.clear()"
              color="round-dark-primary"
              type="button"
            >
              <XIcon class="h-3 w-3" />
            </AppBtn>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
