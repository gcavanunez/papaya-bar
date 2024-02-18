import { ref } from 'vue'

const confirmModalToggle = ref(false)
const awaitFunc = ref(() => {})

export const useGlobalConfirm = () => {
	const toggleGlobal = () => {
		confirmModalToggle.value = !confirmModalToggle.value
	}
	const triggerConfirm = async (func: () => void) => {
		awaitFunc.value = func
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
		triggerConfirm,
		confirmAction,
		cancelAction,
	}
}
