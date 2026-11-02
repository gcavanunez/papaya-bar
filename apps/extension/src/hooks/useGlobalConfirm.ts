import { ref } from 'vue'

export type ConfirmOptions = {
	title?: string
	message?: string
	confirmLabel?: string
	/** Red confirm button; set false for reversible actions */
	destructive?: boolean
}

const DEFAULT_OPTIONS: Required<ConfirmOptions> = {
	title: 'Are you sure?',
	message: 'This action cannot be undone.',
	confirmLabel: 'Confirm',
	destructive: true,
}

const confirmModalToggle = ref(false)
const awaitFunc = ref(() => {})
const confirmOptions = ref<Required<ConfirmOptions>>({ ...DEFAULT_OPTIONS })

export const useGlobalConfirm = () => {
	const toggleGlobal = () => {
		confirmModalToggle.value = !confirmModalToggle.value
	}
	const triggerConfirm = async (func: () => void, options: ConfirmOptions = {}) => {
		awaitFunc.value = func
		confirmOptions.value = { ...DEFAULT_OPTIONS, ...options }
		toggleGlobal()
	}
	const confirmAction = () => {
		awaitFunc.value()
		awaitFunc.value = () => {}
		toggleGlobal()
	}
	const cancelAction = () => {
		awaitFunc.value = () => {}
		toggleGlobal()
	}

	return {
		toggleGlobal,
		confirmModalToggle,
		confirmOptions,
		triggerConfirm,
		confirmAction,
		cancelAction,
	}
}
