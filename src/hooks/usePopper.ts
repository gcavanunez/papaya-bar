import { ref, onMounted, watchEffect, Component } from 'vue'
import { createPopper, Instance, Options } from '@popperjs/core'

// Currently using Popper with a bunch of data makes it feel somewhat janky aside from
// types for accessing el
// explore (Float UI, HeadlessUI
// - https://stackblitz.com/edit/github-9s97hz?file=src%2FApp.vue
// - https://github.com/floating-ui/floating-ui/issues/1375
// - https://github.com/floating-ui/floating-ui/issues/1375
// -  https://headlessui-vue-git-fork-iendeavor-fix-compo-d17f9c-tailwindlabs.vercel.app/menu/menu-with-transition-and-popper#account-settings
export const usePopper = (options: Options) => {
	// Not happy anys
	let reference = ref<any | null>(null)
	// ought to be singleton popper any
	let popper = ref<any | null>(null)

	const sup = ref(true)

	onMounted(() => {
		watchEffect((onInvalidate) => {
			if (!popper.value) return
			if (!reference.value) return

			let popperEl = popper.value.el || popper.value
			let referenceEl = reference.value.el || reference.value

			if (!(referenceEl instanceof HTMLElement)) return
			if (!(popperEl instanceof HTMLElement)) return
			console.log({ popper: popper.value })
			console.log({ popperEl: popper.value.el })
			// console.log(typeof popperEl)

			let { destroy } = createPopper(referenceEl, popperEl, {
				...options,
				modifiers: [
					...options.modifiers,
					{
						name: 'fixBodyTransform',
						enabled: true,
						phase: 'main',
						fn: ({ state }) => {
							if (sup.value) {
								let bodyRect = document.body.getBoundingClientRect()
								// console.log({ hi: bodyRect.x, bodyRect, popperRect })
								const popperRect = state.elements.popper.getBoundingClientRect()
								state.modifiersData!.popperOffsets!.x =
									state.modifiersData!.popperOffsets!.x - popperRect.width
								// state.modifiersData!.popperOffsets!.x =
								// 	state.modifiersData!.popperOffsets!.x - 224
							}
						},
					},
				],
				// modifiers:[{}],
				onFirstUpdate: async (newState) => {
					console.log('Popper positioned on', newState.placement)
					sup.value = false
					// newState.modifiersData!.popperOffsets!.x =
					// 	newState.modifiersData!.popperOffsets!.x - 224
					// forceUpdate()
					// setOptions({})
					// const truEstate = await update()
					// state = { ...state, ...truEstate }
					// console.log({ newState })
					// state.modifiersData.popperOffsets!.x = state.modifiersData.popperOffsets!.x - 224
					// // 224
					// state = await popperEl.update()
					// popperEl.setOptions((options) => ({
					//   ...options,
					//   modifiers: [
					//     ...options.modifiers!,
					//     {name:'offset'}
					//     // { name: 'eventListeners', enabled: true },
					//   ],
					// }));
					// setOptions({ modifiers: [{ name: 'offset', options: { offset: [0, 10] } }] })
					//
				},
			})

			onInvalidate(destroy)
		})
	})

	return [reference, popper]
}
