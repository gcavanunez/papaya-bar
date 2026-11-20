/**
 * useAnchoredPanel — place a dropdown panel (a menu, a popover) next to its button,
 * from the top of the page, so no scrolling list or card clips it. It opens on the
 * preferred side and flips when there's no room, slides to stay on screen, and is
 * capped to the space left (the panel scrolls inside).
 *
 * Put `<span :ref="onMarker" hidden />` inside the panel: the panel only exists while
 * open, and the marker reports it. `findButton` gets from the panel to its button.
 */
import { computed, nextTick, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import {
	autoUpdate,
	flip,
	offset,
	shift,
	size,
	useFloating,
	type Placement,
} from '@floating-ui/vue'

const EDGE = 8
const MIN_HEIGHT = 120

export function useAnchoredPanel(options: {
	placement: MaybeRefOrGetter<Placement>
	findButton: (panel: HTMLElement) => HTMLElement | null
	/** Tallest the panel gets, in pixels; it never exceeds the space on screen */
	maxHeight?: number
	/**
	 * Move the panel with top/left instead of a transform. Needed when the panel holds
	 * a fixed-position pop-up (a date picker): a transform would trap it inside.
	 */
	transform?: boolean
}) {
	const panel = shallowRef<HTMLElement | null>(null)
	const button = shallowRef<HTMLElement | null>(null)

	// Headless UI links a panel and its button only once both have rendered, which can
	// be after the marker reports in: look again after rendering, and once more after
	// the next frame
	function locate() {
		button.value = panel.value ? options.findButton(panel.value) : null
	}
	function onMarker(el: unknown) {
		panel.value = el instanceof HTMLElement ? el.parentElement : null
		locate()
		if (!panel.value) return
		void nextTick(locate)
		requestAnimationFrame(() => {
			if (!button.value) locate()
		})
	}

	const { floatingStyles, placement } = useFloating(button, panel, {
		strategy: 'fixed',
		placement: computed(() => toValue(options.placement)),
		// Recompute from scratch each time the panel opens
		open: computed(() => !!panel.value),
		transform: options.transform ?? true,
		middleware: [
			offset(6),
			flip({ padding: EDGE }),
			shift({ padding: EDGE }),
			size({
				padding: EDGE,
				apply({ availableHeight, elements }) {
					const cap = options.maxHeight ?? Infinity
					const height = Math.max(MIN_HEIGHT, Math.min(cap, availableHeight))
					elements.floating.style.maxHeight = `${height}px`
				},
			}),
		],
		whileElementsMounted: autoUpdate,
	})

	// Grow out of the corner nearest the button
	const style = computed(() => {
		const [side, edge] = placement.value.split('-')
		const vertical = side === 'top' ? 'bottom' : 'top'
		const horizontal = edge === 'end' ? 'right' : edge === 'start' ? 'left' : 'center'
		return { ...floatingStyles.value, transformOrigin: `${vertical} ${horizontal}` }
	})

	return { onMarker, style }
}

/** A Headless UI menu panel's button: the panel is labelled by it */
export function menuButtonOf(panel: HTMLElement): HTMLElement | null {
	const id = panel.getAttribute('aria-labelledby')
	return id ? document.getElementById(id) : null
}

/** A Headless UI popover panel's button: the button says it controls the panel */
export function popoverButtonOf(panel: HTMLElement): HTMLElement | null {
	return panel.id
		? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(panel.id)}"]`)
		: null
}
