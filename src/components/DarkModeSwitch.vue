<script lang="ts" setup>
import { SunIcon, MoonIcon } from '@heroicons/vue/24/outline'
import { Switch } from '@headlessui/vue'

import { useDark } from '@vueuse/core'
import { computed, onMounted } from 'vue'

const isDark = useDark()
onMounted(() => {
	const d = document.documentElement
	if (isDark) {
		d.style.colorScheme = 'dark'
	} else {
		d.style.colorScheme = 'light'
	}
})
const enabled = computed({
	get() {
		return isDark.value
	},
	set(val) {
		console.log({ val })
		const d = document.documentElement
		if (val) {
			d.style.colorScheme = 'dark'
		} else {
			d.style.colorScheme = 'light'
		}
		isDark.value = val
	},
})
</script>

<template>
	<Switch
		v-model="enabled"
		:class="enabled ? 'bg-vercel-accents-5' : 'bg-slate-200'"
		class="relative ml-5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-papaya-900 focus-visible:ring-opacity-75"
	>
		<span class="sr-only">Use setting</span>
		<span
			aria-hidden="true"
			:class="
				enabled ? 'translate-x-5 bg-black text-white' : 'translate-x-0 bg-white text-gray-700'
			"
			class="pointer-events-none inline-flex h-5 w-5 transform items-center justify-center rounded-full shadow-2xl ring-0 transition duration-200 ease-in-out"
		>
			<transition
				enter-active-class="transition ease-out duration-100"
				enter-from-class="transform opacity-0 scale-95"
				enter-to-class="transform opacity-100 scale-100"
				leave-active-class="transition ease-in duration-75"
				leave-from-class="transform opacity-100 scale-100"
				leave-to-class="transform opacity-0 scale-95"
			>
				<MoonIcon class="h-4 w-4" v-if="enabled"></MoonIcon>
				<SunIcon class="h-4 w-4" v-else></SunIcon>
			</transition>
		</span>
	</Switch>
</template>
