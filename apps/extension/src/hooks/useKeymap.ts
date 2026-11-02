import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * A small vim-style keymap engine.
 *
 * - Declarative bindings (the same table drives dispatch, which-key and the help overlay)
 * - Multi-key sequences ('g g', 'd d', 'm w')
 * - Count prefixes ('3j', '10k', '3dd')
 * - Mode awareness (normal / visual / search)
 * - An optional Ctrl layer: while typing in one mode, Ctrl+<key> runs another mode's
 *   plain-key binding (Ctrl+x in the search box behaves like x in normal mode)
 *
 * A single window keydown listener dispatches everything; it stays out of the way
 * of real typing targets, Headless UI menus/dialogs and focused buttons.
 */

export type KeymapMode = 'normal' | 'visual' | 'search'

export type KeyBindingContext = { count: number }

export type KeyBinding = {
	id: string
	/** Space-separated key sequence, e.g. 'g g', 'ctrl+d', 'G', '?' */
	keys: string
	/** Modes in which the binding is active. Defaults to ['normal', 'visual'] */
	modes?: KeymapMode[]
	description: string
	/** Section title used to group bindings in the help overlay */
	group: string
	/** Hidden bindings still fire but are omitted from help + which-key (aliases) */
	hidden?: boolean
	/** Fire on native key-repeat (hold-to-scroll). Destructive actions should not. */
	repeat?: boolean
	run: (ctx: KeyBindingContext) => void
}

/** While in `from`, Ctrl+<key> falls back to the plain-key bindings of `to` */
export type CtrlLayer = {
	from: KeymapMode
	to: KeymapMode
	/** Plain keys the layer never captures (text editing, browser-reserved, …) */
	exclude?: string[]
}

export type KeyHint = { keys: string; description: string }

const DEFAULT_MODES: KeymapMode[] = ['normal', 'visual']
const CHORD_RESOLVE_MS = 450
const MAX_COUNT_DIGITS = 3
const CTRL_HINT_DELAY_MS = 350

const TOKEN_LABELS: Record<string, string> = {
	enter: 'Enter',
	escape: 'Esc',
	space: 'Space',
	backspace: 'Bksp',
	delete: 'Del',
	'shift+delete': 'Shift-Del',
	arrowdown: '↓',
	arrowup: '↑',
	arrowleft: '←',
	arrowright: '→',
	pagedown: 'PgDn',
	pageup: 'PgUp',
}

export function prettyToken(token: string): string {
	if (TOKEN_LABELS[token]) return TOKEN_LABELS[token]
	if (token.startsWith('ctrl+')) return `Ctrl-${prettyToken(token.slice(5))}`
	if (token.startsWith('shift+')) return `Shift-${token.slice(6)}`
	return token
}

export function prettyKeys(keys: string): string[] {
	return keys.split(' ').map(prettyToken)
}

function eventToToken(e: KeyboardEvent, { ignoreCtrl = false } = {}): string | null {
	if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
		return null
	}
	// Leave cmd/alt combos to the browser and other handlers (e.g. ⌘K palette)
	if (e.metaKey || e.altKey) return null
	const ctrl = e.ctrlKey && !ignoreCtrl
	const raw = e.key === ' ' ? 'space' : e.key
	if (raw.length === 1) {
		// Case carries shift information for printable keys ('G' vs 'g')
		return ctrl ? `ctrl+${raw.toLowerCase()}` : raw
	}
	let token = raw.toLowerCase()
	if (e.shiftKey) token = `shift+${token}`
	if (ctrl) token = `ctrl+${token}`
	return token
}

const NON_TEXT_INPUT_TYPES = new Set([
	'checkbox',
	'radio',
	'button',
	'submit',
	'reset',
	'range',
	'file',
	'color',
])

function isTypingTarget(el: Element | null): boolean {
	if (!el) return false
	if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
	if (el.tagName === 'INPUT') {
		return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)
	}
	return (el as HTMLElement).isContentEditable
}

function isInOverlay(el: Element | null): boolean {
	if (!el || el === document.body) return false
	return !!el.closest('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
}

function seqOf(binding: KeyBinding): string[] {
	return binding.keys.split(' ')
}

export function useKeymap(options: {
	mode: () => KeymapMode
	bindings: () => KeyBinding[]
	ctrlLayer?: CtrlLayer
}) {
	const pendingTokens = ref<string[]>([])
	const pendingCount = ref('')
	// The pending sequence was started through the Ctrl layer
	const layerPending = ref(false)
	const ctrlHeld = ref(false)
	const ctrlHintsVisible = ref(false)
	let chordTimer: ReturnType<typeof setTimeout> | null = null
	let ctrlHintTimer: ReturnType<typeof setTimeout> | null = null

	const reset = () => {
		pendingTokens.value = []
		pendingCount.value = ''
		layerPending.value = false
		if (chordTimer) {
			clearTimeout(chordTimer)
			chordTimer = null
		}
	}

	const hideCtrlHints = () => {
		ctrlHintsVisible.value = false
		if (ctrlHintTimer) {
			clearTimeout(ctrlHintTimer)
			ctrlHintTimer = null
		}
	}

	const releaseCtrl = () => {
		ctrlHeld.value = false
		hideCtrlHints()
	}

	const bindingsForMode = (mode: KeymapMode) =>
		options.bindings().filter((b) => (b.modes ?? DEFAULT_MODES).includes(mode))

	const matching = (mode: KeymapMode, attempted: string[]) =>
		bindingsForMode(mode).filter((b) => {
			const seq = seqOf(b)
			return seq.length >= attempted.length && attempted.every((t, i) => seq[i] === t)
		})

	const layerFor = (mode: KeymapMode) =>
		options.ctrlLayer?.from === mode ? options.ctrlLayer : null

	/**
	 * Bindings this key could start or continue. A Ctrl chord with no binding of its own
	 * falls through the Ctrl layer; once a layer sequence is pending, the following keys
	 * continue it with or without Ctrl held.
	 */
	const resolve = (e: KeyboardEvent, token: string, mode: KeymapMode) => {
		const layer = layerFor(mode)
		if (layerPending.value && layer) {
			const plain = eventToToken(e, { ignoreCtrl: true }) ?? token
			const attempted = [...pendingTokens.value, plain]
			return { viaLayer: true, attempted, candidates: matching(layer.to, attempted) }
		}
		const attempted = [...pendingTokens.value, token]
		const candidates = matching(mode, attempted)
		if (candidates.length || !layer || !e.ctrlKey || pendingTokens.value.length) {
			return { viaLayer: false, attempted, candidates }
		}
		const plain = eventToToken(e, { ignoreCtrl: true })
		if (!plain || layer.exclude?.includes(plain)) {
			return { viaLayer: false, attempted, candidates }
		}
		return { viaLayer: true, attempted: [plain], candidates: matching(layer.to, [plain]) }
	}

	const fire = (binding: KeyBinding) => {
		const count = Math.max(1, Number.parseInt(pendingCount.value || '1', 10))
		reset()
		binding.run({ count })
	}

	const onKeydown = (e: KeyboardEvent) => {
		const active = document.activeElement

		// Menus, listboxes and dialogs own their keyboard interactions
		if (isInOverlay(active)) {
			reset()
			return
		}

		const mode = options.mode()
		const typing = isTypingTarget(active)
		// While typing anywhere that isn't our search input, do nothing
		if (typing && mode !== 'search') {
			reset()
			return
		}

		// Holding Ctrl alone shows which chords are available after a short delay
		if (e.key === 'Control') {
			if (!ctrlHeld.value && !e.metaKey && !e.altKey) {
				ctrlHeld.value = true
				ctrlHintTimer = setTimeout(() => {
					ctrlHintsVisible.value = ctrlHeld.value
				}, CTRL_HINT_DELAY_MS)
			}
			return
		}
		if (!e.ctrlKey)
			releaseCtrl() // keyup can be missed (focus changes, OS shortcuts)
		else hideCtrlHints() // a chord is being typed; the hint has done its job

		const token = eventToToken(e)
		if (!token) return

		// Let focused buttons/links/checkboxes receive their native activation keys
		if (
			!typing &&
			active &&
			active !== document.body &&
			(token === 'enter' || token === 'space')
		) {
			const tag = active.tagName
			if (
				tag === 'BUTTON' ||
				tag === 'A' ||
				tag === 'INPUT' ||
				active.getAttribute('role') === 'button'
			) {
				return
			}
		}

		// Native key-repeat: only bindings that opt in (navigation) fire repeatedly.
		// Everything else bound is swallowed so a held key can't complete 'dd' etc.
		if (e.repeat) {
			const { attempted, candidates } = resolve(e, token, mode)
			if (candidates.length === 0) return // unbound: let native repeat behave (typing, etc.)
			e.preventDefault()
			e.stopPropagation()
			const exact = candidates.find((b) => seqOf(b).length === attempted.length)
			if (exact?.repeat && pendingTokens.value.length === 0) {
				fire(exact)
			}
			return
		}

		// Escape aborts a pending sequence/count before anything else
		if (token === 'escape' && (pendingTokens.value.length > 0 || pendingCount.value !== '')) {
			reset()
			e.preventDefault()
			return
		}

		// Count prefix (vim-style: digits before a sequence starts; bare 0 excluded)
		if (
			!typing &&
			mode !== 'search' &&
			pendingTokens.value.length === 0 &&
			/^[0-9]$/.test(token) &&
			(token !== '0' || pendingCount.value !== '') &&
			pendingCount.value.length < MAX_COUNT_DIGITS
		) {
			pendingCount.value += token
			e.preventDefault()
			return
		}

		if (chordTimer) {
			clearTimeout(chordTimer)
			chordTimer = null
		}

		const { viaLayer, attempted, candidates } = resolve(e, token, mode)

		if (candidates.length === 0) {
			const wasPending = pendingTokens.value.length > 0 || pendingCount.value !== ''
			const wasLayer = layerPending.value
			reset()
			// Swallow keys that dead-end a sequence, pass through fresh unbound keys.
			// A plain key that abandons a Ctrl-layer chord in the search box still types.
			if (wasPending && !(wasLayer && typing && !e.ctrlKey)) e.preventDefault()
			return
		}

		e.preventDefault()
		e.stopPropagation()

		const exact = candidates.find((b) => seqOf(b).length === attempted.length)
		const hasLonger = candidates.some((b) => seqOf(b).length > attempted.length)

		if (exact && !hasLonger) {
			fire(exact)
			return
		}

		pendingTokens.value = attempted
		layerPending.value = viaLayer
		if (exact && hasLonger) {
			// Ambiguous: wait briefly for a longer chord, then fall back to the exact match
			chordTimer = setTimeout(() => fire(exact), CHORD_RESOLVE_MS)
		}
	}

	const onKeyup = (e: KeyboardEvent) => {
		if (e.key === 'Control') releaseCtrl()
	}

	const onBlur = () => {
		reset()
		releaseCtrl()
	}

	/** Which-key data: possible completions for the pending sequence */
	const whichKey = computed<KeyHint[]>(() => {
		if (pendingTokens.value.length === 0) return []
		const mode = options.mode()
		const layer = layerFor(mode)
		const resolveMode = layerPending.value && layer ? layer.to : mode
		return bindingsForMode(resolveMode)
			.filter((b) => !b.hidden)
			.filter((b) => {
				const seq = seqOf(b)
				return (
					seq.length > pendingTokens.value.length &&
					pendingTokens.value.every((t, i) => seq[i] === t)
				)
			})
			.map((b) => ({
				keys: seqOf(b).slice(pendingTokens.value.length).map(prettyToken).join(' '),
				description: b.description,
			}))
	})

	/** Everything reachable while Ctrl is held, written without the Ctrl prefix */
	const ctrlHints = computed<KeyHint[]>(() => {
		if (!ctrlHintsVisible.value || pendingTokens.value.length) return []
		const mode = options.mode()
		const own = bindingsForMode(mode)
		const hints: KeyHint[] = own
			.filter((b) => !b.hidden && seqOf(b)[0].startsWith('ctrl+'))
			.map((b) => ({
				keys: seqOf(b)
					.map((t) => prettyToken(t.replace(/^ctrl\+/, '')))
					.join(' '),
				description: b.description,
			}))
		const layer = layerFor(mode)
		if (!layer) return hints
		// Same precedence as dispatch: the mode's own Ctrl chords shadow the layer
		const taken = new Set(own.map((b) => seqOf(b)[0]))
		for (const b of bindingsForMode(layer.to)) {
			const [first] = seqOf(b)
			if (b.hidden || first.startsWith('ctrl+') || layer.exclude?.includes(first)) continue
			if (taken.has(`ctrl+${first.length === 1 ? first.toLowerCase() : first}`)) continue
			hints.push({ keys: seqOf(b).map(prettyToken).join(' '), description: b.description })
		}
		return hints
	})

	/** Statusline display, e.g. '3d', '2' or 'Ctrl-z' */
	const pendingDisplay = computed(() => {
		const tokens = pendingTokens.value.map(prettyToken).join('')
		return `${pendingCount.value}${layerPending.value ? 'Ctrl-' : ''}${tokens}`
	})

	onMounted(() => {
		window.addEventListener('keydown', onKeydown)
		window.addEventListener('keyup', onKeyup)
		window.addEventListener('blur', onBlur)
	})
	onUnmounted(() => {
		reset()
		releaseCtrl()
		window.removeEventListener('keydown', onKeydown)
		window.removeEventListener('keyup', onKeyup)
		window.removeEventListener('blur', onBlur)
	})

	return { pendingDisplay, whichKey, ctrlHeld, ctrlHints, reset }
}
