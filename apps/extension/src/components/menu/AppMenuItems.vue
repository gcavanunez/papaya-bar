<script setup lang="ts">
/**
 * A menu's panel, rendered at the top of the page and placed next to its button
 * (useAnchoredPanel), so no scrolling list or card clips it.
 */
import { MenuItems } from '@headlessui/vue'
import { menuButtonOf, useAnchoredPanel } from '@/hooks/useAnchoredPanel'

const props = withDefaults(
	defineProps<{
		align?: 'left' | 'right'
		placement?: 'bottom' | 'top'
		width?: string
	}>(),
	{
		align: 'right',
		placement: 'bottom',
		width: 'w-56',
	},
)

const { onMarker, style } = useAnchoredPanel({
	placement: () => `${props.placement}-${props.align === 'right' ? 'end' : 'start'}` as const,
	findButton: menuButtonOf,
	maxHeight: 320,
})
</script>

<template>
	<Teleport to="body">
		<transition
			enter-active-class="transition duration-100 ease-out"
			enter-from-class="scale-95 opacity-0"
			enter-to-class="scale-100 opacity-100"
			leave-active-class="transition duration-75 ease-in"
			leave-from-class="scale-100 opacity-100"
			leave-to-class="scale-95 opacity-0"
		>
			<MenuItems
				:class="['menu-panel z-[65] overflow-y-auto overscroll-contain', width]"
				:style="style"
			>
				<span :ref="onMarker" hidden />
				<slot />
			</MenuItems>
		</transition>
	</Teleport>
</template>
