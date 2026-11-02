export const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/**
 * The command palette opens with ⌘K on macOS and Ctrl+K elsewhere. Using only the
 * platform's modifier leaves Ctrl+K free for the tab search's "move up" on macOS.
 */
export const isPaletteShortcut = (e: KeyboardEvent) =>
	e.key.toLowerCase() === 'k' && (isMac ? e.metaKey : e.ctrlKey)

export const paletteShortcutLabel = isMac ? '⌘K' : 'Ctrl K'

/**
 * Ctrl chords Chrome keeps for itself outside macOS: the page never receives the keydown.
 * Checked with real key events on Linux (Chrome 148): Ctrl+N opens a window, Ctrl+T a tab,
 * Ctrl+PgDn / Ctrl+PgUp switch tabs. Keys are keymap tokens without the `ctrl+` prefix.
 */
export const browserReservedCtrlKeys: string[] = isMac ? [] : ['n', 't', 'pagedown', 'pageup']
