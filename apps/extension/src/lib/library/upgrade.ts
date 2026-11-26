/**
 * Upgrading a stored library index to the current schema, one link per version, when
 * the library opens (and after a move-in or an import writes an older shape).
 *
 * Only the background worker upgrades, but it may be stopped halfway and run the chain
 * again, and copies upgraded apart may still merge, so every link is idempotent and
 * deterministic: it only reads the index (and what is stored for this device) and
 * writes the same result every time.
 */
import { makePreview, type SavedTab, type SessionContent } from './model'
import type { Library } from './store'

export const LIBRARY_SCHEMA_VERSION = 4
/** Where the index is kept as it was before the first upgrade, in case one goes wrong */
export const INDEX_V1_KEY = 'library:index:v1'

/** Each link takes the index from its version to the next, and records that it did */
const LINKS: Record<number, (lib: Library) => Promise<void>> = {
	1: oneToTwo,
	2: twoToThree,
	3: threeToFour,
}

export interface UpgradeOptions {
	/** Runs once before the first change; if it fails, nothing is changed */
	keepCopy?: () => Promise<void>
}

/**
 * Why an index this build does not know is left as it is. The could-not-open card it is
 * shown in already says that nothing was changed.
 */
export const UNKNOWN_SCHEMA_ERROR =
	'These sessions were saved by a newer version of Papaya, and this version cannot open them. Update Papaya to open them.'

/**
 * Bring the index up to LIBRARY_SCHEMA_VERSION. An index at a version this build has no
 * way up from (saved by a newer build, say) is refused before anything changes.
 */
export async function upgradeLibrary(lib: Library, options: UpgradeOptions = {}): Promise<void> {
	let version = Number(lib.store.getValue('schemaVersion')) || 0
	if (version === LIBRARY_SCHEMA_VERSION) return
	// Nothing stored yet, or rows written before the version was recorded
	if (version === 0) {
		if (!lib.store.hasTable('sessions') && !lib.store.hasValue('openSessionId')) return
		version = 1
	}
	for (let v = version; v < LIBRARY_SCHEMA_VERSION; v++) {
		if (typeof LINKS[v] !== 'function') throw new Error(UNKNOWN_SCHEMA_ERROR)
	}
	if (version > LIBRARY_SCHEMA_VERSION) throw new Error(UNKNOWN_SCHEMA_ERROR)
	await options.keepCopy?.()
	for (; version < LIBRARY_SCHEMA_VERSION; version++) await LINKS[version](lib)
}

/** Copy the stored index, untouched, to INDEX_V1_KEY unless a copy is already there */
export async function keepIndexCopy(index: unknown): Promise<void> {
	if (index === undefined) return
	if (INDEX_V1_KEY in (await chrome.storage.local.get(INDEX_V1_KEY))) return
	await chrome.storage.local.set({ [INDEX_V1_KEY]: index })
}

const LEGACY_VALUES = ['openSessionId', 'parkedSessionId', 'homeSessionId'] as const

/**
 * 1 → 2: which session is open becomes this device's own state; a session's status
 * becomes `archivedAt`; Parked becomes an ordinary session.
 */
async function oneToTwo(lib: Library): Promise<void> {
	const { store } = lib
	const open = store.getValue('openSessionId')
	if (typeof open === 'string' && open && store.hasRow('sessions', open)) {
		if (!(await lib.device.read()).openSessionId) await lib.device.set({ openSessionId: open })
	}
	store.transaction(() => {
		for (const [id, row] of Object.entries(store.getTable('sessions'))) {
			if (row.kind === 'parked') store.setCell('sessions', id, 'kind', 'normal')
			if (row.status === undefined) continue
			// A session archived since an interrupted upgrade keeps its own date
			if (row.status === 'archived' && !(Number(row.archivedAt) > 0)) {
				const at = Number(row.updatedAt) || Number(row.createdAt) || 1
				store.setCell('sessions', id, 'archivedAt', at)
			} else if (row.archivedAt === undefined) {
				store.setCell('sessions', id, 'archivedAt', 0)
			}
			store.delCell('sessions', id, 'status')
		}
		for (const key of LEGACY_VALUES) store.delValue(key)
		store.setValue('schemaVersion', 2)
	})
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const count = (value: unknown) => (typeof value === 'number' ? value : 0)

/**
 * 2 → 3: a session's newest version becomes its content, and every other version a
 * checkpoint with the same id, so each entry keeps exactly one owner. A row whose entry
 * is not stored is dropped (a session with a missing newest version has no content), so
 * nothing points at nothing. The next autosave takes what is open as the open session's.
 */
async function twoToThree(lib: Library): Promise<void> {
	const { store } = lib
	const stored = new Set(await lib.blobs.ids())
	store.transaction(() => {
		const contents = new Set<string>()
		for (const [id, row] of Object.entries(store.getTable('sessions'))) {
			const head = text(row.headVersionId)
			// A content written since (an interrupted upgrade, a merged copy) stays
			let content = text(row.contentId)
			if (!content && head) {
				if (stored.has(head)) {
					content = head
					store.setCell('sessions', id, 'contentId', head)
				} else if (count(row.tabCount) || text(row.preview) !== '[]') {
					store.setPartialRow('sessions', id, {
						contentId: '',
						tabCount: 0,
						preview: '[]',
					})
				}
			}
			if (content) contents.add(content)
			else if (row.contentId === undefined) store.setCell('sessions', id, 'contentId', '')
			if (row.headVersionId !== undefined) store.delCell('sessions', id, 'headVersionId')
		}
		for (const [id, row] of Object.entries(store.getTable('versions'))) {
			if (!contents.has(id) && stored.has(id)) {
				store.setRow('checkpoints', id, {
					sessionId: text(row.sessionId),
					createdAt: count(row.createdAt),
					reason: text(row.reason) || 'manual',
					tabCount: count(row.tabCount),
					windowCount: count(row.windowCount),
					groupCount: count(row.groupCount),
				})
			}
			store.delRow('versions', id)
		}
		store.setValue('schemaVersion', 3)
	})
	await lib.device.set({ adoptLive: true })
}

/** A stashed group's tabs as a session's content: one window holding that one group */
function asOneGroup(tabs: SavedTab[], name: string, color: string): SessionContent {
	return {
		tabs: tabs.map((tab, i) => ({ ...tab, windowId: 1, groupId: 1, active: i === 0 })),
		groups: [{ id: 1, title: name, color, collapsed: false, windowId: 1 }],
		windows: [{ id: 1 }],
	}
}

/**
 * 3 → 4: each stashed group becomes a closed session of its own, named and colored like
 * the group, whose content is that one group (so opening a copy brings the group back
 * into a window). The session takes the stash's id, and so does its entry, rewritten in
 * a session's shape. A stash whose entry isn't stored (or holds no tabs) is dropped, and
 * a session already made from one (an interrupted upgrade, a merged copy) stays as it is.
 */
async function threeToFour(lib: Library): Promise<void> {
	const { store } = lib
	const stored = new Set(await lib.blobs.ids())
	const stashes = Object.entries(store.getTable('stashed'))
	const contents: Record<string, SessionContent> = {}
	for (const [id, row] of stashes) {
		if (!stored.has(id) || store.hasRow('sessions', id)) continue
		const tabs = (await lib.blobs.get(id))?.tabs ?? []
		if (tabs.length) contents[id] = asOneGroup(tabs, groupName(row), groupColor(row))
	}
	// Entries are written before the index points at them
	if (Object.keys(contents).length) await lib.blobs.set(contents)
	store.transaction(() => {
		for (const [id, row] of stashes) {
			const data = contents[id]
			if (data) {
				const from = text(store.getCell('sessions', text(row.sessionId), 'name'))
				const at = count(row.createdAt)
				store.setRow('sessions', id, {
					name: groupName(row),
					description: from ? `Was a stashed group in ${from}` : 'Was a stashed group',
					color: groupColor(row),
					kind: 'normal',
					archivedAt: 0,
					createdAt: at,
					updatedAt: at,
					lastOpenedAt: 0,
					contentId: id,
					tabCount: data.tabs.length,
					preview: makePreview(data),
					origin: 'stashed-group',
					originId: id,
				})
			}
			store.delRow('stashed', id)
		}
		store.setValue('schemaVersion', 4)
	})
}

const groupName = (row: Record<string, unknown>) => text(row.name).trim() || 'Unnamed group'
const groupColor = (row: Record<string, unknown>) => text(row.color) || 'grey'
