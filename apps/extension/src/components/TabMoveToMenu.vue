<script lang="ts" setup>
import { moveTabs, moveTabTo } from '@/helpers'
import { Group, Tab, WindowsMap } from '@/types'
import { Menu, MenuButton } from '@headlessui/vue'
import {
	ArrowTopRightOnSquareIcon,
	ChevronDownIcon,
	PlusIcon,
	WindowIcon,
} from '@heroicons/vue/16/solid'
import { tabGroupHex } from '@/hooks/useGlobalModals'
import { button } from '@/lib/ui'
import AppMenuItem from './menu/AppMenuItem.vue'
import AppMenuItems from './menu/AppMenuItems.vue'

type Props = {
	tabs: Tab[]
	loadedGroups: Group[]
	windowsMap: WindowsMap
	canCreateGroup?: boolean
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
			<slot name="button-trigger">
				<button type="button" :class="button({ intent: 'secondary', size: 'sm' })">
					<slot name="menu-trigger-label">Move</slot>
					<ChevronDownIcon class="size-3.5 opacity-60" aria-hidden="true" />
				</button>
			</slot>
		</MenuButton>
		<AppMenuItems width="w-60">
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
				<AppMenuItem v-if="canCreateGroup" :icon="PlusIcon" @click="onGroupTrigger">
					New tab group…
				</AppMenuItem>
			</template>
		</AppMenuItems>
	</Menu>
</template>
