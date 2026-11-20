/**
 * Edits to a closed session's tabs, each with what undoes it.
 *
 * An edit's undo puts back exactly what that edit changed, into whatever the content has
 * become since, so edits can be undone in any order without undoing the ones after them.
 * Edits never change the tabs and groups they leave alone, so undo finds things by
 * identity; content read again from storage is matched by value instead.
 */
import { NO_GROUP, type SavedGroup, type SavedTab, type SessionContent } from './model'

export interface Edit {
	/** The content after the edit */
	data: SessionContent
	/** Put back what the edit changed, in a content the edit (and maybe others) made */
	undo(current: SessionContent): SessionContent
}

const same = <T>(a: T, b: T) => a === b || JSON.stringify(a) === JSON.stringify(b)
/** Where an item is: the same object, else an equal one */
function find<T>(list: T[], item: T | null): number {
	if (item == null) return -1
	const index = list.indexOf(item)
	return index >= 0 ? index : list.findIndex((other) => same(other, item))
}

/** A removed item, and where it was: after `before`, or at `index` if that is gone */
interface Removed<T> {
	item: T
	before: T | null
	index: number
}

function removedFrom<T>(list: T[], keep: (item: T) => boolean): Removed<T>[] {
	return list.flatMap((item, index) =>
		keep(item) ? [] : [{ item, before: list[index - 1] ?? null, index }],
	)
}

/** Put removed items back, in the order they were, unless they are back already */
function putBack<T>(list: T[], removed: Removed<T>[]): T[] {
	const out = [...list]
	for (const { item, before, index } of removed) {
		if (out.includes(item)) continue
		const after = before ? find(out, before) : -1
		const at = before == null ? 0 : after >= 0 ? after + 1 : Math.min(index, out.length)
		out.splice(at, 0, item)
	}
	return out
}

const unchanged = (data: SessionContent): Edit => ({ data, undo: (current) => current })

export function removeTab(data: SessionContent, tab: SavedTab): Edit {
	if (!data.tabs.includes(tab)) return unchanged(data)
	const tabs = removedFrom(data.tabs, (t) => t !== tab)
	return {
		data: { ...data, tabs: data.tabs.filter((t) => t !== tab) },
		undo: (current) => ({ ...current, tabs: putBack(current.tabs, tabs) }),
	}
}

/** Remove a group and its tabs */
export function removeGroup(data: SessionContent, group: SavedGroup): Edit {
	if (!data.groups.includes(group)) return unchanged(data)
	const inGroup = (t: SavedTab) => t.groupId === group.id
	const tabs = removedFrom(data.tabs, (t) => !inGroup(t))
	const groups = removedFrom(data.groups, (g) => g !== group)
	return {
		data: {
			...data,
			tabs: data.tabs.filter((t) => !inGroup(t)),
			groups: data.groups.filter((g) => g !== group),
		},
		undo: (current) => ({
			...current,
			tabs: putBack(current.tabs, tabs),
			groups: putBack(current.groups, groups),
		}),
	}
}

/** Keep a group's tabs, loose, and drop the group */
export function ungroup(data: SessionContent, group: SavedGroup): Edit {
	if (!data.groups.includes(group)) return unchanged(data)
	const loosened = new Map<SavedTab, SavedTab>()
	const tabs = data.tabs.map((tab) => {
		if (tab.groupId !== group.id) return tab
		const loose = { ...tab, groupId: NO_GROUP }
		loosened.set(loose, tab)
		return loose
	})
	const groups = removedFrom(data.groups, (g) => g !== group)
	return {
		data: { ...data, tabs, groups: data.groups.filter((g) => g !== group) },
		undo: (current) => ({
			...current,
			tabs: current.tabs.map((tab) => {
				if (loosened.has(tab)) return loosened.get(tab)!
				const match = [...loosened].find(([loose]) => same(loose, tab))
				return match ? match[1] : tab
			}),
			groups: putBack(current.groups, groups),
		}),
	}
}

/** Rename a group; undo puts the old name back unless it has been renamed again since */
export function renameGroup(data: SessionContent, group: SavedGroup, title: string): Edit {
	const index = data.groups.indexOf(group)
	if (index < 0 || group.title === title) return unchanged(data)
	const renamed = { ...group, title }
	const replace = (groups: SavedGroup[], at: number, next: SavedGroup) =>
		groups.map((g, i) => (i === at ? next : g))
	return {
		data: { ...data, groups: replace(data.groups, index, renamed) },
		undo: (current) => {
			const at = find(current.groups, renamed)
			return at < 0 ? current : { ...current, groups: replace(current.groups, at, group) }
		},
	}
}
