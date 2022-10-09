<script setup lang="ts">
import { useChromeTabs } from '@/hooks/useChromeTabs'
import TabManager from '@/components/TabManager.vue'

const { windowsMap, loadedGroups, loadedTabHistory, lookUpTab, loadedTabs } = useChromeTabs()
</script>

<template>
	<TabManager
		:loaded-tabs="loadedTabs"
		:loaded-groups="loadedGroups"
		:loaded-tab-history="loadedTabHistory"
		:look-up-tab="lookUpTab"
		:windows-map="windowsMap"
	/>
</template>
