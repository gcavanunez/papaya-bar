import { ref, watch } from 'vue'

interface Settings {
	copyLinksInMarkdownFormat: boolean
}

const defaultSettings: Settings = {
	copyLinksInMarkdownFormat: false,
}

const SETTINGS_STORAGE_KEY = 'chonching-tabs-settings'

const settings = ref<Settings>({ ...defaultSettings })

const loadSettings = async () => {
	try {
		const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
		if (stored[SETTINGS_STORAGE_KEY]) {
			settings.value = { ...defaultSettings, ...stored[SETTINGS_STORAGE_KEY] }
		}
	} catch (error) {
		console.warn('Failed to load settings:', error)
	}
}

const saveSettings = async () => {
	try {
		await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings.value })
	} catch (error) {
		console.warn('Failed to save settings:', error)
	}
}

watch(settings, saveSettings, { deep: true })

export const useSettings = () => {
	return {
		settings,
		loadSettings,
		saveSettings,
	}
}