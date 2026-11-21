/**
 * pathGroups — a site's tabs as folders by address path, like a file tree: tabs whose
 * paths share a prefix (github.com/gcavanunez/…) fold together under it.
 *
 * A folder needs at least `minItems` tabs; a prefix fewer tabs share stays as loose
 * tabs in its parent. A folder holding nothing but one subfolder merges with it
 * ("gcavanunez/papaya-bar"), and a folder holding every one of the site's tabs is
 * skipped, since the site already says as much.
 */

export interface PathFolder<T> {
	/** The whole path prefix, e.g. "/gcavanunez/papaya-bar" */
	path: string
	/** What it adds to its parent's path, e.g. "gcavanunez/papaya-bar" */
	label: string
	folders: PathFolder<T>[]
	/** Tabs directly in this folder, in their original order */
	items: T[]
	/** Every tab in this folder and its subfolders, in their original order */
	all: T[]
}

export interface PathTree<T> {
	folders: PathFolder<T>[]
	/** Tabs in no folder, in their original order */
	items: T[]
}

/** The path segments of an address, decoded; no query or fragment */
export function pathSegments(url: string | undefined): string[] {
	let pathname: string
	try {
		pathname = new URL(url ?? '').pathname
	} catch {
		return []
	}
	return pathname
		.split('/')
		.filter(Boolean)
		.map((segment) => {
			try {
				return decodeURIComponent(segment)
			} catch {
				return segment
			}
		})
}

interface Node<T> {
	children: Map<string, Node<T>>
	/** Tabs whose path ends here */
	here: T[]
	/** Tabs at or below this node */
	all: T[]
}

const newNode = <T>(): Node<T> => ({ children: new Map(), here: [], all: [] })

export function pathTree<T extends { url?: string }>(
	items: T[],
	options: { minItems?: number; maxDepth?: number } = {},
): PathTree<T> {
	const minItems = options.minItems ?? 2
	const maxDepth = options.maxDepth ?? 4

	const root = newNode<T>()
	for (const item of items) {
		let node = root
		node.all.push(item)
		for (const segment of pathSegments(item.url)) {
			let child = node.children.get(segment)
			if (!child) {
				child = newNode<T>()
				node.children.set(segment, child)
			}
			child.all.push(item)
			node = child
		}
		node.here.push(item)
	}

	const build = (node: Node<T>, path: string, depth: number): PathTree<T> => {
		const folders: PathFolder<T>[] = []
		if (depth < maxDepth) {
			for (const [segment, child] of node.children) {
				if (child.all.length < minItems) continue
				const childPath = `${path}/${segment}`
				const inner = build(child, childPath, depth + 1)
				let folder: PathFolder<T> = {
					path: childPath,
					label: segment,
					...inner,
					all: child.all,
				}
				// A folder with nothing but one subfolder is that subfolder, one level deeper
				while (!folder.items.length && folder.folders.length === 1) {
					const only = folder.folders[0]
					folder = { ...only, label: `${folder.label}/${only.label}` }
				}
				folders.push(folder)
			}
		}
		const inFolder = new Set(folders.flatMap((folder) => folder.all))
		folders.sort((a, b) => b.all.length - a.all.length || a.label.localeCompare(b.label))
		return { folders, items: node.all.filter((item) => !inFolder.has(item)) }
	}

	let tree = build(root, '', 0)
	// A folder holding every tab adds nothing to the site's own header
	while (!tree.items.length && tree.folders.length === 1) {
		const only = tree.folders[0]
		tree = { folders: only.folders, items: only.items }
	}
	return tree
}
