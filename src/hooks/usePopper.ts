import { ref, onMounted, watchEffect } from 'vue'
import { createPopper, Options } from '@popperjs/core'

/**
 *
 * Currently using Popper with a bunch of data makes it feel somewhat janky aside from
 * types for accessing el
 * explore (Float UI, HeadlessUI
 * - https://stackblitz.com/edit/github-9s97hz?file=src%2FApp.vue
 * - https://github.com/floating-ui/floating-ui/issues/1375
 * - https://github.com/floating-ui/floating-ui/issues/1375
 * - https://headlessui-vue-git-fork-iendeavor-fix-compo-d17f9c-tailwindlabs.vercel.app/menu/menu-with-transition-and-popper#account-settings
 */
export const usePopper = (options: Options) => {
	// Not happy anys
	const reference = ref<any | null>(null)
	// ought to be singleton popper any
	const popper = ref<any | null>(null)

	const inBounds = ref(true)

	onMounted(() => {
		watchEffect((onInvalidate) => {
			if (!popper.value) return
			if (!reference.value) return

			const popperEl = popper.value.el || popper.value
			const referenceEl = reference.value.el || reference.value

			if (!(referenceEl instanceof HTMLElement)) return
			if (!(popperEl instanceof HTMLElement)) return

			const { destroy } = createPopper(referenceEl, popperEl, {
				...options,
				modifiers: [
					...options.modifiers,
					{
						name: 'fixBodyTransform',
						enabled: true,
						phase: 'main',
						fn: ({ state }) => {
							if (inBounds.value) {
								const popperRect = state.elements.popper.getBoundingClientRect()
								state.modifiersData!.popperOffsets!.x =
									state.modifiersData!.popperOffsets!.x - popperRect.width
							}
						},
					},
				],
				onFirstUpdate: async () => {
					inBounds.value = false
				},
			})

			onInvalidate(destroy)
		})
	})

	return [reference, popper]
}
