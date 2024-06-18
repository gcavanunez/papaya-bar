<script lang="ts" setup>
import { moveTabs, moveTabTo } from '@/helpers'
import { Group, Tab, WindowsMap } from '@/types'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/vue'
import { ChevronDownIcon } from '@heroicons/vue/20/solid'
import { autoUpdate, autoPlacement, offset, shift, useFloating } from '@floating-ui/vue'
import { PlusIcon, ArrowTopRightOnSquareIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'
import AppButton from './AppButton.vue'

type Props = {
	tabs: Tab[]
	loadedGroups: Group[]
	windowsMap: WindowsMap
	canCreateGroup?: boolean
}
const trigger = ref<Element | null>(null)
const container = ref(null)
const { x, y, strategy } = useFloating(trigger, container, {
	strategy: 'fixed',
	middleware: [
		offset(10),
		autoPlacement({ allowedPlacements: ['bottom-end', 'top-end'] }),
		shift(),
	],

	whileElementsMounted: autoUpdate,
})
//https://stackoverflow.com/questions/71425980/how-get-ref-from-slot-in-vue-3
const setSlotRef = (el: any) => {
	trigger.value = el
}

const props = withDefaults(defineProps<Props>(), {
	canCreateGroup: true,
})

const emits = defineEmits<{
	(e: 'on-create-group', payload: { tabs: Tab[] }): void
}>()

const onGroupTrigger = () => {
	emits('on-create-group', { tabs: props.tabs })
}
</script>
<template>
	<div class="relative">
		<Menu v-slot="{ open }">
			<span class="pointer-events-auto relative inline-flex text-left">
				<!-- class="pointer-events-auto inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5" -->
				<!-- <MenuButton ref="trigger"> -->
				<MenuButton as="div">
					<slot name="button-trigger" :trigger="setSlotRef">
						<AppButton ref="trigger" type="button" size="x-small" intent="common">
							<slot name="menu-trigger-label">
								<span class="inline-flex items-center">
									Move to
									<ChevronDownIcon
										class="-mr-1 ml-1 h-2.5 w-2.5 text-slate-800 dark:text-white"
										aria-hidden="true"
									/>
								</span>
							</slot>
						</AppButton>
					</slot>
				</MenuButton>
			</span>
			<!-- <div
				class="z-30"
				ref="container"
				:style="{
					position: strategy,
					transform: `translate3d(${Math.round(x ?? 0)}px,${Math.round(y ?? 0)}px,0)`,
					top: '0',
					left: '0',
					width: 'max-content',
				}"
			> -->
			<div
				ref="container"
				class="z-30 w-56"
				:style="{
					position: strategy,
					transform: `translate3d(${Math.round(x ?? 0)}px,${Math.round(y ?? 0)}px,0)`,
					top: '0',
					left: '0',
				}"
			>
				<transition
					enter-active-class="transition duration-100 ease-out"
					enter-from-class="transform scale-95 opacity-0"
					enter-to-class="transform scale-100 opacity-100"
					leave-active-class="transition duration-75 ease-in"
					leave-from-class="transform scale-100 opacity-100"
					leave-to-class="transform z-30 scale-95 opacity-0"
				>
					<!-- origin-top-right -->
					<!-- class="absolute right-0 mt-2 divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none" -->
					<MenuItems
						class="z-40 w-full divide-y divide-gray-100 rounded-md border border-gray-200 bg-white shadow-lg outline-none"
					>
						<div class="px-1 py-1">
							<!-- :disabled="windowId === tab.windowId" -->
							<MenuItem
								v-for="[windowId, value] in [...windowsMap]"
								v-slot="{ active, disabled }"
								:key="`${windowId}-enabled-windows`"
								@click="
									moveTabTo(tabs, {
										containerId: windowId,
										type: 'window_container',
									})
								"
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
						<div v-if="loadedGroups.length" class="px-1 py-1">
							<MenuItem
								v-for="loadedGroup in loadedGroups"
								v-slot="{ active, disabled }"
								:key="`${loadedGroup.id}-custom-selected`"
								@click="
									moveTabTo(tabs, {
										containerId: loadedGroup.id,
										type: 'group_container',
									})
								"
							>
								<button
									:class="[
										active ? 'bg-blue-500 text-white' : 'text-slate-700',
										'group flex w-full items-center rounded-md px-2 py-2 text-sm',
										disabled ? 'opacity-50' : 'opacity-100',
									]"
								>
									{{ loadedGroup.title }}
								</button>
							</MenuItem>
						</div>
						<div v-if="canCreateGroup" class="px-1 py-1">
							<MenuItem v-slot="{ active, disabled }" @click="onGroupTrigger">
								<button
									:class="[
										active ? 'bg-blue-500 text-white' : 'text-slate-700',
										'group flex w-full items-center rounded-md px-2 py-2 text-sm',
										disabled ? 'opacity-50' : 'opacity-100',
									]"
								>
									<PlusIcon
										:class="[
											active
												? 'text-white'
												: 'text-slate-400  group-hover:text-white dark:text-vercel-accents-5',
											'-ml-1 mr-1.5 h-4 w-4 flex-shrink-0',
										]"
										aria-hidden="true"
									/>
									Group tabs
								</button>
							</MenuItem>
							<MenuItem v-slot="{ active, disabled }" @click="moveTabs(tabs)">
								<button
									:class="[
										active ? 'bg-blue-500 text-white' : 'text-slate-700',
										'group flex w-full items-center rounded-md px-2 py-2 text-sm',
										disabled ? 'opacity-50' : 'opacity-100',
									]"
								>
									<ArrowTopRightOnSquareIcon
										:class="[
											active
												? 'text-white'
												: 'text-slate-400  group-hover:text-white dark:text-vercel-accents-5',
											'-ml-1 mr-1.5 h-4 w-4 flex-shrink-0',
										]"
										aria-hidden="true"
									/>
									New window
								</button>
							</MenuItem>
						</div>
					</MenuItems>
				</transition>
			</div>
			<!-- </div> -->
		</Menu>
	</div>
</template>
