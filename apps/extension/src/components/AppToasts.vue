<script setup lang="ts">
import 'vue-sonner/style.css'
import { Toaster } from 'vue-sonner'
import { computed } from 'vue'
import { useDark } from '@vueuse/core'

const isDark = useDark()
const theme = computed(() => {
	return isDark.value ? 'dark' : 'light'
})
</script>

<template>
	<!-- Bottom offset keeps toasts clear of the tab manager's statusline -->
	<Toaster :theme :offset="{ bottom: '52px', right: '24px' }" />
</template>
