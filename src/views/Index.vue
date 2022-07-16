<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  PlusIcon,
  XIcon,
  MinusIcon,
  ChevronDownIcon,
} from '@heroicons/vue/solid'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { ChevronUpIcon } from '@heroicons/vue/solid'
import { TabGroup, TabList, Tab } from '@headlessui/vue'
import { copyToClipboard } from '../utils'
import { usePopper } from '@/hooks/usePopper'

type ChromeTab = chrome.tabs.Tab
type Tab = chrome.tabs.Tab & { stableId: string }
type Group = chrome.tabGroups.TabGroup
type Grouped = Record<string, Tab[]>

const changeTab = (index: number) => {
  selectedTab.value = index
}
const selectedTab = ref(0)

const categories = ref({
  All: [],
  Grouped: [],
  Windows: [],
  Filters: [],
})
// chrome.tabs
const searchTerm = ref<string>('')
const loadedTabs = ref<Tab[]>([])
const tabWithIconIssues = ref<string[]>([])
const tabsSelected = ref<Set<string>>(new Set())
const loadedGroups = ref<Group[]>([])
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
})
let [trigger, container] = usePopper({
  placement: 'top-start',
  strategy: 'fixed',
  modifiers: [{ name: 'offset', options: { offset: [0, 10] } }],
})

const goTo = (tab: Tab) => {
  if (tab.id) {
    chrome.windows.update(tab.windowId, { focused: true })
    chrome.tabs.update(tab.id, { active: true })
    // chrome.tabs.get(tab.id, function (onTab) {
    //   chrome.tabs.highlight({ tabs: onTab.index }, function () {})
    // })
  }
}
const closeTabs = (tabs: Tab[]) => {
  tabs.forEach((row) => {
    if (row.id) {
      chrome.tabs.remove(row.id)
    }
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
const closeTab = (tab: Tab) => {
  if (tab.id) {
    chrome.tabs.remove(tab.id)
  }
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
const copyLink = (tab: Tab) => {
  const text = `${tab.title}\n${tab.url}`
  copyToClipboard(text)
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
const onImageLoadError = (tab: Tab) => {
  tabWithIconIssues.value.push(`${tab.id}`)
}
const moveTabTo = (tabs: Tab[], windowId: number) => {
  tabs.forEach((row) => {
    if (row.id) {
      chrome.tabs.move(row.id, {
        index: -1,
        windowId: windowId,
      })
    }
  })
}
</script>

<template>
  <div class="bg-slate-100 relative">
    <header
      class="sticky top-0 z-30 h-[72px] bg-slate-100 bg-opacity-50 backdrop-blur backdrop-filter firefox:bg-opacity-90 flex items-center"
    >
      <div
        class="container mx-auto max-w-7xl flex justify-between items-center sm:px-2 px-4"
      >
        <div class="">
          <router-link :to="{ name: 'index', hash: `#head` }">
            <h1 class="text-slate-700 text-2xl">
              All Tabs - {{ loadedTabs.length }}
            </h1>
          </router-link>
        </div>
        <div
          class="flex divide-slate-300 divide-x max-w-3xl w-full justify-end"
        >
          <div class="px-4 w-full flex items-center max-w-md flex-shrink">
            <label for="search" class="sr-only">Search tabs</label>
            <input
              type="text"
              id="search"
              v-model="searchTerm"
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-slate-300 rounded-md"
              placeholder="Search"
            />
          </div>
          <div class="w-full max-w-md px-4 flex-grow">
            <TabGroup @change="changeTab" :selectedIndex="selectedTab">
              <TabList class="flex space-x-1 rounded-lg bg-blue-900/20 p-1">
                <Tab
                  v-for="category in Object.keys(categories)"
                  as="template"
                  :key="category"
                  v-slot="{ selected }"
                >
                  <button
                    :class="[
                      'w-full rounded-md py-2 px-3 text-sm font-medium leading-5 text-blue-700',
                      'ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2',
                      selected
                        ? 'bg-white shadow'
                        : 'text-blue-50 hover:bg-white/[0.12] hover:text-white',
                    ]"
                  >
                    {{ category }}
                  </button>
                </Tab>
              </TabList>
            </TabGroup>
          </div>
        </div>
      </div>
    </header>
    <div class="container mx-auto py-6 max-w-5xl px-4 sm:px-2" id="head">
      <div class="grid gap-6 grid-cols-3">
        <div>
          <ul
            role="list"
            class="space-y-6 text-sm leading-6 text-slate-700 lg:sticky lg:top-0 lg:-mt-16 lg:h-screen lg:w-72 lg:overflow-y-auto lg:py-16 lg:pr-8 pl-2 lg:[mask-image:linear-gradient(to_bottom,transparent,white_4rem,white)]"
          >
            <li v-for="(group, index) in grouped" :key="`list-${index}`">
              <Disclosure v-slot="{ open }">
                <DisclosureButton
                  class="flex w-full justify-between rounded-lg bg-blue-100 px-4 py-2 text-left text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring focus-visible:ring-blue-500 focus-visible:ring-opacity-75 items-center space-x-2"
                >
                  <router-link
                    :to="{ name: 'index', hash: `#section-${index}` }"
                    class="font-semibold text-slate-900 w-full inline-flex justify-between"
                  >
                    <div>{{ index }}</div>
                    <div
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 shadow-sm"
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
        <div class="col-span-2 space-y-6">
          <div
            class="bg-white shadow-md rounded-lg divide-y divide-slate-100"
            v-for="(group, index) in grouped"
            :key="index"
            :id="`section-${index}`"
          >
            <div class="px-4 md:px-6 py-4">
              <h2 class="sr-only">{{ index }}</h2>
              <div class="flex items-center space-x-2">
                <button
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 shadow-sm"
                >
                  {{ index }}
                </button>
                <button
                  @click="selectGroup(group)"
                  type="button"
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 shadow-sm"
                >
                  Select
                </button>
                <button
                  @click="copyLinks(group)"
                  type="button"
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 shadow-sm"
                >
                  Copy
                </button>
                <button
                  @click="closeTabs(group)"
                  type="button"
                  class="inline-flex shadow-sm items-center px-1 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-800"
                >
                  <XIcon class="h-3 w-3" />
                </button>
              </div>
            </div>
            <ul class="px-4 md:px-6 py-4">
              <li
                v-for="tab in group"
                class="py-2 w-full relative group"
                :key="`${tab.windowId}-${tab.index}`"
              >
                <div
                  class="absolute pointer-events-none inset-0 group-hover:visible focus-within:visible invisible flex justify-between px-2 items-center"
                >
                  <div>
                    <button
                      class="pointer-events-auto w-8 h-8 rounded-full bg-slate-100 text-slate-800 flex items-center justify-center shadow border border-slate-100"
                      @click="toggleSelection(tab)"
                    >
                      <PlusIcon
                        class="h-4 w-4"
                        v-if="!tabsSelected.has(tab.stableId)"
                      />
                      <MinusIcon class="h-4 w-4" v-else />
                    </button>
                  </div>
                  <div class="flex space-x-2 items-center">
                    <Menu
                      as="div"
                      class="relative inline-block text-left pointer-events-auto"
                    >
                      <div>
                        <MenuButton
                          class="pointer-events-auto px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 inline-flex justify-center items-center"
                        >
                          Move to
                          <ChevronDownIcon
                            class="ml-2 -mr-1 h-3 w-3 text-slate-800"
                            aria-hidden="true"
                          />
                        </MenuButton>
                      </div>

                      <transition
                        enter-active-class="transition duration-100 ease-out"
                        enter-from-class="transform scale-95 opacity-0"
                        enter-to-class="transform scale-100 opacity-100"
                        leave-active-class="transition duration-75 ease-in"
                        leave-from-class="transform scale-100 opacity-100"
                        leave-to-class="transform scale-95 opacity-0"
                      >
                        <MenuItems
                          class="absolute right-0 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10"
                        >
                          <div class="px-1 py-1">
                            <MenuItem
                              v-slot="{ active, disabled }"
                              :disabled="windowId === tab.windowId"
                              :key="`${windowId}-${tab.index}`"
                              v-for="[windowId, value] in [...windowsMap]"
                              @click="moveTabTo([tab], windowId)"
                            >
                              <button
                                :class="[
                                  active
                                    ? 'bg-blue-500 text-white'
                                    : 'text-slate-700',
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
                    <button
                      class="pointer-events-auto px-2 py-0.5 rounded-full bg-slate-100 text-slate-800"
                      @click="copyLink(tab)"
                    >
                      Copy
                    </button>
                    <button
                      class="pointer-events-auto px-1 py-1 rounded-full bg-slate-100 text-slate-800"
                      @click="closeTab(tab)"
                    >
                      <XIcon class="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <button
                  class="rounded-lg py-2 px-2 flex items-center bg-white hover:bg-slate-200 transition shadow-sm hover:shadow w-full"
                  :class="
                    !tabsSelected.has(tab.stableId)
                      ? 'bg-white hover:bg-slate-200'
                      : 'bg-blue-100 hover:bg-blue-200'
                  "
                  :title="tab.url"
                  @click="goTo(tab)"
                >
                  <div class="shrink-0">
                    <img
                      class="w-8 h-8 rounded-full"
                      :src="tab.favIconUrl ? tab.favIconUrl : 'bug'"
                      alt=""
                      @error="(e: Event) => onImageLoadError(tab)"
                      v-if="!tabWithIconIssues.includes(`${tab.id}`)"
                    />
                    <div class="w-8 h-8 rounded-full bg-slate-700" v-else></div>
                  </div>
                  <div
                    class="text-sm font-medium text-slate-900 ml-2 truncate group-hover:mr-40"
                  >
                    {{ tab.title }}
                  </div>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <footer
      v-if="[...tabsSelected].length > 0"
      class="bottom-0 left-0 right-0 bg-slate-100 sticky z-10 w-full shadow-lg"
    >
      <div class="w-full mx-auto max-w-7xl px-4 sm:px-2">
        <div
          class="shadow-slate-200 rounded-lg w-full px-4 md:px-6 py-4 text-lg flex justify-between items-center"
        >
          <div>{{ [...tabsSelected].length }} Tabs selected</div>
          <div class="flex space-x-2 items-center">
            <button
              @click="tabsSelected.clear()"
              type="button"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white text-slate-800 shadow-sm"
            >
              Deselect all
            </button>
            <Menu
              as="div"
              class="relative text-left pointer-events-auto inline-flex"
            >
              <MenuButton
                ref="trigger"
                class="pointer-events-auto px-2 py-0.5 rounded-full bg-white text-slate-800 inline-flex justify-center items-center text-xs font-medium"
              >
                Move to
                <ChevronDownIcon
                  class="ml-2 -mr-1 h-3 w-3 text-slate-800"
                  aria-hidden="true"
                />
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
                  ref="container"
                  class="absolute right-0 mt-2 w-56 origin-bottom-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10 bottom-0"
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
            <button
              @click="moveTabs(selectedGroup)"
              type="button"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white text-slate-800 shadow-sm"
            >
              Move
            </button>
            <button
              @click="copyLinks(selectedGroup)"
              type="button"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white text-slate-800 shadow-sm"
            >
              Copy
            </button>
            <button
              @click="closeTabs(selectedGroup)"
              type="button"
              class="inline-flex shadow-sm items-center px-1 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-800"
            >
              <XIcon class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
