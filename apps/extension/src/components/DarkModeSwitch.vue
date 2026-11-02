<script lang="ts" setup>
import { SunIcon, MoonIcon } from '@heroicons/vue/20/solid'
import { useDark } from '@vueuse/core'
import { watchEffect } from 'vue'
import AppButton from './AppButton.vue'

const isDark = useDark()

watchEffect(() => {
	document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
})
</script>

<template>
	<AppButton
		intent="ghost"
		size="md"
		square
		:title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
		@click="isDark = !isDark"
	>
		<span class="sr-only">Toggle dark mode</span>
		<MoonIcon v-if="isDark" class="size-4" aria-hidden="true" />
		<SunIcon v-else class="size-4" aria-hidden="true" />
	</AppButton>
</template>
