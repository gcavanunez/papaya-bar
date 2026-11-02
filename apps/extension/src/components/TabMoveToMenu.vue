<script lang="ts" setup>
import { moveTabs, moveTabTo } from '@/helpers'
import { Group, Tab, WindowsMap } from '@/types'
import { Menu, MenuButton, MenuItems } from '@headlessui/vue'
import {
	ArrowTopRightOnSquareIcon,
	ChevronDownIcon,
	PlusIcon,
	WindowIcon,
} from '@heroicons/vue/16/solid'
import { autoUpdate, autoPlacement, offset, shift, useFloating } from '@floating-ui/vue'
import { ref } from 'vue'
import { tabGroupHex } from '@/hooks/useGlobalModals'
import { button } from '@/lib/ui'
import AppMenuItem from './menu/AppMenuItem.vue'

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
		offset(6),
		autoPlacement({ allowedPlacements: ['bottom-end', 'top-end'] }),
		shift({ padding: 8 }),
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
	<Menu as="div" class="relative inline-flex">
		<MenuButton as="div" class="inline-flex">
			<slot name="button-trigger" :trigger="setSlotRef">
				<button
					ref="trigger"
					type="button"
					:class="button({ intent: 'secondary', size: 'sm' })"
				>
					<slot name="menu-trigger-label">Move</slot>
					<ChevronDownIcon class="size-3.5 opacity-60" aria-hidden="true" />
				</button>
			</slot>
		</MenuButton>
		<Teleport to="body">
			<div
				ref="container"
				class="z-[55] w-60"
				:style="{
					position: strategy,
					transform: `translate3d(${Math.round(x ?? 0)}px,${Math.round(y ?? 0)}px,0)`,
					top: '0',
					left: '0',
				}"
			>
				<transition
					enter-active-class="transition duration-100 ease-out"
					enter-from-class="scale-95 opacity-0"
					enter-to-class="scale-100 opacity-100"
					leave-active-class="transition duration-75 ease-in"
					leave-from-class="scale-100 opacity-100"
					leave-to-class="scale-95 opacity-0"
				>
					<MenuItems class="menu-panel max-h-80 overflow-y-auto">
						<p class="menu-heading">Move to window</p>
						<AppMenuItem
							v-for="[windowId, value] in [...windowsMap]"
							:key="`${windowId}-window`"
							:icon="WindowIcon"
							@click="
								moveTabTo(tabs, {
									containerId: windowId,
									type: 'window_container',
								})
							"
						>
							{{ value }}
						</AppMenuItem>
						<AppMenuItem :icon="ArrowTopRightOnSquareIcon" @click="moveTabs(tabs)">
							New window
						</AppMenuItem>

						<template v-if="loadedGroups.length || canCreateGroup">
							<div class="menu-separator" />
							<p class="menu-heading">Add to tab group</p>
							<AppMenuItem
								v-for="loadedGroup in loadedGroups"
								:key="`${loadedGroup.id}-group`"
								@click="
									moveTabTo(tabs, {
										containerId: loadedGroup.id,
										type: 'group_container',
									})
								"
							>
								<template #leading>
									<span
										class="flex size-4 shrink-0 items-center justify-center"
										aria-hidden="true"
									>
										<span
											class="size-2.5 rounded-full"
											:style="{
												backgroundColor: tabGroupHex(loadedGroup.color),
											}"
										/>
									</span>
								</template>
								{{ loadedGroup.title || 'Untitled group' }}
							</AppMenuItem>
							<AppMenuItem
								v-if="canCreateGroup"
								:icon="PlusIcon"
								@click="onGroupTrigger"
							>
								New tab group…
							</AppMenuItem>
						</template>
					</MenuItems>
				</transition>
			</div>
		</Teleport>
	</Menu>
</template>
