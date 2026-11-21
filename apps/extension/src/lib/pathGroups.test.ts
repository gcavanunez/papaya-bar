import { describe, expect, it } from 'vitest'
import { pathSegments, pathTree, type PathFolder, type PathTree } from './pathGroups'

const tab = (path: string) => ({ url: `https://github.com${path}` })

/** A tree as nested labels and the paths of its loose tabs, to compare at a glance */
type Shape = { [label: string]: Shape | string[] }
function shape(tree: PathTree<{ url?: string }> | PathFolder<{ url?: string }>): Shape {
	const out: Shape = {}
	for (const folder of tree.folders) out[`${folder.label}/`] = shape(folder)
	if (tree.items.length) out.tabs = tree.items.map((item) => new URL(item.url!).pathname)
	return out
}

describe('pathSegments', () => {
	it('splits the path, decoded, without the query or fragment', () => {
		expect(
			pathSegments('https://github.com/gcavanunez/papaya-bar/pull/12?diff=split#top'),
		).toEqual(['gcavanunez', 'papaya-bar', 'pull', '12'])
		expect(pathSegments('https://example.com/My%20Docs/a')).toEqual(['My Docs', 'a'])
		expect(pathSegments('https://example.com/')).toEqual([])
		expect(pathSegments('not a url')).toEqual([])
	})
})

describe('pathTree', () => {
	it('folds tabs that share a path prefix, nesting where a deeper prefix is shared too', () => {
		const tabs = [
			tab('/gcavanunez/papaya-bar/pull/12'),
			tab('/notifications'),
			tab('/anomalyco/opencode/issues/1'),
			tab('/gcavanunez/papaya-bar/issues/3'),
			tab('/gcavanunez/dotfiles'),
			tab('/anomalyco/browse'),
		]
		expect(shape(pathTree(tabs))).toEqual({
			'gcavanunez/': {
				'papaya-bar/': {
					tabs: ['/gcavanunez/papaya-bar/pull/12', '/gcavanunez/papaya-bar/issues/3'],
				},
				tabs: ['/gcavanunez/dotfiles'],
			},
			'anomalyco/': { tabs: ['/anomalyco/opencode/issues/1', '/anomalyco/browse'] },
			tabs: ['/notifications'],
		})
	})

	it('keeps a folder of one tab as a loose tab', () => {
		const tree = pathTree([tab('/a/x'), tab('/b/y'), tab('/b/z')])
		expect(shape(tree)).toEqual({ 'b/': { tabs: ['/b/y', '/b/z'] }, tabs: ['/a/x'] })
	})

	it('merges a folder holding nothing but one subfolder', () => {
		const tree = pathTree([
			tab('/docs/api/v2/users'),
			tab('/docs/api/v2/orders'),
			tab('/blog/x'),
		])
		expect(shape(tree)).toEqual({
			'docs/api/v2/': { tabs: ['/docs/api/v2/users', '/docs/api/v2/orders'] },
			tabs: ['/blog/x'],
		})
		expect(tree.folders[0].path).toBe('/docs/api/v2')
	})

	it("skips a folder holding every one of the site's tabs", () => {
		const tree = pathTree([
			tab('/gcavanunez/a/x'),
			tab('/gcavanunez/a/y'),
			tab('/gcavanunez/b'),
		])
		expect(shape(tree)).toEqual({
			'a/': { tabs: ['/gcavanunez/a/x', '/gcavanunez/a/y'] },
			tabs: ['/gcavanunez/b'],
		})
		expect(tree.folders[0].path).toBe('/gcavanunez/a')
	})

	it('gives nothing to fold when no prefix is shared', () => {
		expect(shape(pathTree([tab('/a'), tab('/b'), tab('/')]))).toEqual({
			tabs: ['/a', '/b', '/'],
		})
	})

	it('puts bigger folders first, then by name, and keeps tabs in their order', () => {
		const tree = pathTree([
			tab('/b/1'),
			tab('/a/1'),
			tab('/c/1'),
			tab('/b/2'),
			tab('/a/2'),
			tab('/c/2'),
			tab('/c/3'),
		])
		expect(tree.folders.map((f) => f.label)).toEqual(['c', 'a', 'b'])
		expect(tree.folders[0].all.map((t) => t.url)).toEqual([
			'https://github.com/c/1',
			'https://github.com/c/2',
			'https://github.com/c/3',
		])
	})

	it('stops nesting past the depth limit', () => {
		const deep = [tab('/1/2/3/4/5/a'), tab('/1/2/3/4/5/b'), tab('/x')]
		const tree = pathTree(deep, { maxDepth: 2 })
		// Folders exist at depths 1 and 2 only; the merge happens within those
		expect(tree.folders[0].path).toBe('/1/2')
		expect(tree.folders[0].items).toHaveLength(2)
	})
})
