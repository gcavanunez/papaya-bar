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
	<Toaster :theme />
</template>
