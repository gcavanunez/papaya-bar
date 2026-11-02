import { ref } from 'vue'

// Shared open-state for the ⌘K command palette so any surface (header button,
// keyboard shortcut) can drive the single mounted instance.
const isOpen = ref(false)

export function useCommandPalette() {
	return {
		isOpen,
		open: () => (isOpen.value = true),
		close: () => (isOpen.value = false),
		toggle: () => (isOpen.value = !isOpen.value),
	}
}
