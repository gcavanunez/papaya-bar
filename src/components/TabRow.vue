<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import {
  PlusIcon,
  XIcon,
  MinusIcon,
  ChevronDownIcon,
} from '@heroicons/vue/solid'
import { closeTab, copyLink, moveTabTo, goTo } from '@/helpers'
import { Tab } from '@/types'
import { ref } from 'vue'
import { usePopper } from '@/hooks/usePopper'
import AppBtn from './AppBtn.vue'
let [trigger, container] = usePopper({
  placement: 'auto',
  strategy: 'fixed',
  modifiers: [{ name: 'offset', options: { offset: [0, 10] } }],
})

interface Props {
  tab: Tab
  tabsSelected: Set<string>
  windowsMap: Map<number, string>
}
const { tab, tabsSelected, windowsMap } = defineProps<Props>()
const emit = defineEmits<{
  (e: 'toggleSelection', tab: Tab): void
}>()
const hasImageError = ref(false)
const onImageLoadError = () => {
  hasImageError.value = true
}
</script>

<template>
  <li class="group relative w-full py-2" :key="`${tab.windowId}-${tab.index}`">
    <div
      class="pointer-events-none invisible absolute inset-0 flex items-center justify-between px-2 focus-within:visible group-hover:visible"
    >
      <div>
        <button
          class="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-slate-100 bg-slate-100 text-slate-800 shadow-md"
          @click="emit('toggleSelection', tab)"
        >
          <PlusIcon class="h-4 w-4" v-if="!tabsSelected.has(tab.stableId)" />
          <MinusIcon class="h-4 w-4" v-else />
        </button>
      </div>
      <div class="pointer-events-auto flex items-center space-x-2">
        <Menu
          as="div"
          class="pointer-events-auto relative inline-block text-left"
        >
          <div>
            <MenuButton
              ref="trigger"
              class="pointer-events-auto inline-flex items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-slate-800"
            >
              Move to
              <ChevronDownIcon
                class="ml-2 -mr-1 h-3 w-3 text-slate-800"
                aria-hidden="true"
              />
            </MenuButton>
          </div>
          <div ref="container" class="z-20 w-56">
            <transition
              enter-active-class="transition duration-100 ease-out"
              enter-from-class="transform scale-95 opacity-0"
              enter-to-class="transform scale-100 opacity-100"
              leave-active-class="transition duration-75 ease-in"
              leave-from-class="transform scale-100 opacity-100"
              leave-to-class="transform scale-95 opacity-0"
            >
              <!-- origin-top-right -->
              <!-- class="absolute right-0 mt-2 divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none" -->
              <MenuItems
                class="w-full divide-y divide-gray-100 rounded-md border border-gray-200 bg-white shadow-lg outline-none"
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
          </div>
        </Menu>
        <AppBtn @click="copyLink(tab)"> Copy </AppBtn>
        <AppBtn @click="closeTab(tab)" color="round-primary">
          <XIcon class="h-3 w-3" />
        </AppBtn>
      </div>
    </div>
    <button
      class="flex w-full items-center rounded-lg bg-white py-2 px-2 shadow-sm transition hover:bg-slate-200 hover:shadow"
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
          class="h-8 w-8 rounded-full"
          :src="tab.favIconUrl"
          alt=""
          @error="onImageLoadError"
          v-if="!hasImageError && tab.favIconUrl"
        />
        <div class="h-8 w-8 rounded-full bg-slate-700" v-else></div>
      </div>
      <div
        class="ml-2 truncate text-sm font-medium text-slate-900 group-hover:mr-40 group-focus:truncate"
      >
        {{ tab.title }}
      </div>
    </button>
  </li>
</template>
