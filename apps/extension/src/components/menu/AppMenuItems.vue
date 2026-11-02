<script setup lang="ts">
import { MenuItems } from '@headlessui/vue'

withDefaults(
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
</script>

<template>
	<transition
		enter-active-class="transition duration-100 ease-out"
		enter-from-class="scale-95 opacity-0"
		enter-to-class="scale-100 opacity-100"
		leave-active-class="transition duration-75 ease-in"
		leave-from-class="scale-100 opacity-100"
		leave-to-class="scale-95 opacity-0"
	>
		<MenuItems
			:class="[
				'menu-panel absolute z-40 max-h-80 overflow-y-auto',
				width,
				align === 'right' ? 'right-0' : 'left-0',
				placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-1.5',
				placement === 'top'
					? align === 'right'
						? 'origin-bottom-right'
						: 'origin-bottom-left'
					: align === 'right'
						? 'origin-top-right'
						: 'origin-top-left',
			]"
		>
			<slot />
		</MenuItems>
	</transition>
</template>
