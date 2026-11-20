import { describe, expect, it } from 'vitest'
import { removeGroup, removeTab, renameGroup, ungroup } from './edits'
import { NO_GROUP, type SavedGroup, type SavedTab, type SessionContent } from './model'

const tab = (url: string, groupId = NO_GROUP): SavedTab => ({
	url: `https://${url}/`,
	title: url,
	favIconUrl: '',
	windowId: 1,
	groupId,
	active: false,
})
const group = (id: number, title: string): SavedGroup => ({
	id,
	title,
	color: 'blue',
	collapsed: false,
	windowId: 1,
})

function sample(): SessionContent {
	return {
		tabs: [tab('a'), tab('b', 7), tab('c', 7), tab('d'), tab('e', 8)],
		groups: [group(7, 'Docs'), group(8, 'News')],
		windows: [{ id: 1 }],
	}
}
const urls = (data: SessionContent) => data.tabs.map((t) => t.title).join('')
const titles = (data: SessionContent) => data.groups.map((g) => g.title).join(',')

describe('edits to a closed session', () => {
	it('undoes a removed tab back where it was', () => {
		const data = sample()
		const edit = removeTab(data, data.tabs[3])
		expect(urls(edit.data)).toBe('abce')
		expect(edit.undo(edit.data)).toEqual(data)
	})

	it('undoes an earlier edit without undoing the later ones', () => {
		const data = sample()
		const first = removeTab(data, data.tabs[0])
		const second = removeTab(first.data, first.data.tabs[1])
		expect(urls(second.data)).toBe('bde')
		const undone = first.undo(second.data)
		expect(urls(undone)).toBe('abde')
		// And the later one still undoes after it
		expect(urls(second.undo(undone))).toBe('abcde')
	})

	it('puts a tab back after its neighbour even when that neighbour moved', () => {
		const data = sample()
		const edit = removeTab(data, data.tabs[2])
		const other = removeTab(edit.data, edit.data.tabs[0])
		expect(urls(edit.undo(other.data))).toBe('bcde')
	})

	it('removes a group with its tabs, and undo brings both back', () => {
		const data = sample()
		const edit = removeGroup(data, data.groups[0])
		expect(urls(edit.data)).toBe('ade')
		expect(titles(edit.data)).toBe('News')
		expect(edit.undo(edit.data)).toEqual(data)
	})

	it('ungroups, and undo regroups the same tabs', () => {
		const data = sample()
		const edit = ungroup(data, data.groups[0])
		expect(edit.data.tabs.every((t) => t.groupId !== 7)).toBe(true)
		expect(titles(edit.data)).toBe('News')
		expect(edit.undo(edit.data)).toEqual(data)
	})

	it('undoes an ungroup after a loosened tab was removed and put back', () => {
		const data = sample()
		const loose = ungroup(data, data.groups[0])
		const removed = removeTab(loose.data, loose.data.tabs[1])
		const back = removed.undo(removed.data)
		expect(loose.undo(back)).toEqual(data)
	})

	it('renames a group; undo puts the old name back unless renamed again since', () => {
		const data = sample()
		const first = renameGroup(data, data.groups[0], 'Reading')
		expect(titles(first.data)).toBe('Reading,News')
		expect(first.undo(first.data)).toEqual(data)
		const second = renameGroup(first.data, first.data.groups[0], 'Later')
		expect(titles(first.undo(second.data))).toBe('Later,News')
	})

	it('matches by value in content read again from storage', () => {
		const data = sample()
		const edit = removeTab(data, data.tabs[1])
		const stored = JSON.parse(JSON.stringify(edit.data)) as SessionContent
		expect(edit.undo(stored)).toEqual(data)
	})

	it('changes nothing for a tab or group that is no longer there', () => {
		const data = sample()
		expect(removeTab(data, tab('z')).data).toBe(data)
		expect(removeGroup(data, group(9, 'Gone')).data).toBe(data)
		expect(renameGroup(data, data.groups[0], 'Docs').data).toBe(data)
	})
})
