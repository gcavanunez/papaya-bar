<script lang="ts" setup>
import { moveTabs, moveTabTo } from '@/helpers'
import { Group, Tab, WindowsMap } from '@/types'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/vue'
import { ChevronDownIcon } from '@heroicons/vue/20/solid'
import { autoUpdate, autoPlacement, offset, shift, useFloating } from '@floating-ui/vue'
import { PlusIcon, ArrowTopRightOnSquareIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'

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
// https://stackoverflow.com/questions/71425980/how-get-ref-from-slot-in-vue-3
const setSlotRef = (el: HTMLElement | null) => {
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
		<Menu>
			<span class="pointer-events-auto relative inline-flex text-left">
				<!-- class="pointer-events-auto inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:bg-vercel-accents-2 dark:text-white dark:ring-0 dark:highlight-white/5" -->
				<!-- <MenuButton ref="trigger"> -->
				<MenuButton as="div">
					<slot name="button-trigger" :trigger="setSlotRef">
						<button
							ref="trigger"
							type="button"
							class="inline-flex items-center space-x-2 rounded-md border border-slate-200/50 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-white focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-slate-600/50 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-700"
						>
							<slot name="menu-trigger-label">
								<span class="inline-flex items-center space-x-1">
									<span>Move</span>
									<ChevronDownIcon
										class="h-3 w-3 text-slate-400 dark:text-slate-500"
										aria-hidden="true"
									/>
								</span>
							</slot>
						</button>
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
			<Teleport to="body">
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
						enter-active-class="transition duration-200 ease-out"
						enter-from-class="transform scale-95 opacity-0 translate-y-1"
						enter-to-class="transform scale-100 opacity-100 translate-y-0"
						leave-active-class="transition duration-150 ease-in"
						leave-from-class="transform scale-100 opacity-100 translate-y-0"
						leave-to-class="transform scale-95 opacity-0 translate-y-1"
					>
						<MenuItems
							class="z-40 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200/50 bg-white/95 shadow-xl shadow-slate-200/20 backdrop-blur-xl outline-none dark:border-slate-700/50 dark:bg-slate-800/95 dark:shadow-slate-900/20"
						>
							<div class="p-2">
								<div class="mb-2">
									<h3
										class="px-2 py-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
									>
										Windows
									</h3>
								</div>
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
											'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
											active
												? 'bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/20 dark:text-blue-400'
												: 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-700/50',
											disabled
												? 'cursor-not-allowed opacity-50'
												: 'cursor-pointer',
										]"
									>
										<div
											class="mr-3 h-2 w-2 flex-shrink-0 rounded-full bg-green-400"
										></div>
										{{ value }}
									</button>
								</MenuItem>
							</div>
							<div
								v-if="loadedGroups.length"
								class="border-t border-slate-200/50 p-2 dark:border-slate-700/50"
							>
								<div class="mb-2">
									<h3
										class="px-2 py-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
									>
										Groups
									</h3>
								</div>
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
											'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
											active
												? 'bg-purple-500/10 text-purple-600 ring-1 ring-purple-500/20 dark:text-purple-400'
												: 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-700/50',
											disabled
												? 'cursor-not-allowed opacity-50'
												: 'cursor-pointer',
										]"
									>
										<div
											class="mr-3 h-2 w-2 flex-shrink-0 rounded-full"
											:style="{
												backgroundColor: loadedGroup.color || '#8b5cf6',
											}"
										></div>
										{{ loadedGroup.title }}
									</button>
								</MenuItem>
							</div>
							<div
								v-if="canCreateGroup"
								class="border-t border-slate-200/50 p-2 dark:border-slate-700/50"
							>
								<div class="mb-2">
									<h3
										class="px-2 py-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
									>
										Actions
									</h3>
								</div>
								<MenuItem v-slot="{ active, disabled }" @click="onGroupTrigger">
									<button
										:class="[
											'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
											active
												? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-400'
												: 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-700/50',
											disabled
												? 'cursor-not-allowed opacity-50'
												: 'cursor-pointer',
										]"
									>
										<PlusIcon
											:class="[
												'mr-3 h-4 w-4 flex-shrink-0',
												active
													? 'text-emerald-600 dark:text-emerald-400'
													: 'text-slate-400 dark:text-slate-500',
											]"
											aria-hidden="true"
										/>
										Create new group
									</button>
								</MenuItem>
								<MenuItem v-slot="{ active, disabled }" @click="moveTabs(tabs)">
									<button
										:class="[
											'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
											active
												? 'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20 dark:text-orange-400'
												: 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-700/50',
											disabled
												? 'cursor-not-allowed opacity-50'
												: 'cursor-pointer',
										]"
									>
										<ArrowTopRightOnSquareIcon
											:class="[
												'mr-3 h-4 w-4 flex-shrink-0',
												active
													? 'text-orange-600 dark:text-orange-400'
													: 'text-slate-400 dark:text-slate-500',
											]"
											aria-hidden="true"
										/>
										Open in new window
									</button>
								</MenuItem>
							</div>
						</MenuItems>
					</transition>
				</div>
			</Teleport>
			<!-- </div> -->
		</Menu>
	</div>
</template>
