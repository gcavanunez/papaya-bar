/**
 * A library index as schema 2 wrote it (versions, each session pointing at its newest),
 * built with that schema, so upgrade tests start from what is really stored on
 * people's browsers. Its entries come separately, as they are stored separately.
 */
import { createMergeableStore } from 'tinybase'
import type { SessionContent } from '@/lib/library/model'

export function createV2Store() {
	const store = createMergeableStore('papaya-library')
	store.setTablesSchema({
		sessions: {
			name: { type: 'string', default: '' },
			description: { type: 'string', default: '' },
			color: { type: 'string', default: 'grey' },
			kind: { type: 'string', default: 'normal' },
			archivedAt: { type: 'number', default: 0 },
			status: { type: 'string' },
			createdAt: { type: 'number', default: 0 },
			updatedAt: { type: 'number', default: 0 },
			lastOpenedAt: { type: 'number', default: 0 },
			headVersionId: { type: 'string', default: '' },
			tabCount: { type: 'number', default: 0 },
			preview: { type: 'string', default: '[]' },
			origin: { type: 'string', default: '' },
			originId: { type: 'string', default: '' },
		},
		versions: {
			sessionId: { type: 'string', default: '' },
			createdAt: { type: 'number', default: 0 },
			reason: { type: 'string', default: 'manual' },
			tabCount: { type: 'number', default: 0 },
			windowCount: { type: 'number', default: 0 },
			groupCount: { type: 'number', default: 0 },
		},
		stashed: {
			sessionId: { type: 'string', default: '' },
			name: { type: 'string', default: '' },
			color: { type: 'string', default: 'grey' },
			tabCount: { type: 'number', default: 0 },
			preview: { type: 'string', default: '[]' },
			createdAt: { type: 'number', default: 0 },
		},
	})
	store.setValuesSchema({
		openSessionId: { type: 'string' },
		parkedSessionId: { type: 'string' },
		homeSessionId: { type: 'string' },
		schemaVersion: { type: 'number', default: 0 },
		migratedAt: { type: 'number', default: 0 },
	})
	return store
}

export const tabsOf = (...urls: string[]): SessionContent => ({
	tabs: urls.map((url) => ({
		url,
		title: url,
		favIconUrl: '',
		windowId: 1,
		groupId: -1,
		active: false,
	})),
	groups: [],
	windows: [{ id: 1 }],
})

const session = (fields: Record<string, string | number>) => ({
	description: '',
	color: 'grey',
	kind: 'normal',
	archivedAt: 0,
	createdAt: 100,
	updatedAt: 200,
	lastOpenedAt: 0,
	headVersionId: '',
	tabCount: 0,
	preview: '[]',
	origin: 'context',
	originId: '',
	...fields,
})

const version = (sessionId: string, createdAt: number, reason: string, tabCount = 1) => ({
	sessionId,
	createdAt,
	reason,
	tabCount,
	windowCount: 1,
	groupCount: 0,
})

/**
 * Work (newest w2, older w1 and w0, a stashed group), Trip archived with one version,
 * Lost whose newest version's entry is missing (an older one, l0, is stored), and an
 * empty Home with notes
 */
export function sampleV2Store() {
	const store = createV2Store()
	store.transaction(() => {
		store.setRow(
			'sessions',
			'work',
			session({ name: 'Work', lastOpenedAt: 300, headVersionId: 'w2', tabCount: 2 }),
		)
		store.setRow(
			'sessions',
			'trip',
			session({ name: 'Trip', archivedAt: 250, headVersionId: 't1', tabCount: 1 }),
		)
		store.setRow(
			'sessions',
			'lost',
			session({
				name: 'Lost',
				headVersionId: 'l1',
				tabCount: 3,
				preview: '[{"favIconUrl":"","url":"https://l.com"}]',
			}),
		)
		store.setRow(
			'sessions',
			'home',
			session({ name: 'Home', kind: 'home', origin: 'home', description: 'notes' }),
		)
		store.setRow('versions', 'w2', version('work', 180, 'switch', 2))
		store.setRow('versions', 'w1', version('work', 150, 'manual'))
		store.setRow('versions', 'w0', version('work', 120, 'migrated'))
		store.setRow('versions', 't1', version('trip', 140, 'close'))
		store.setRow('versions', 'l1', version('lost', 170, 'switch', 3))
		store.setRow('versions', 'l0', version('lost', 110, 'edit'))
		store.setRow('stashed', 'stash-1', {
			sessionId: 'work',
			name: 'Docs',
			color: 'blue',
			tabCount: 1,
			createdAt: 160,
		})
		store.setValues({ schemaVersion: 2, migratedAt: 90 })
	})
	return store
}

/** The stored entries of the sample: every version's but l1's, and the stashed group's */
export function sampleV2Entries(): Record<string, SessionContent> {
	return {
		w2: tabsOf('https://jira.com', 'https://docs.com'),
		w1: tabsOf('https://jira.com'),
		w0: tabsOf('https://old.com'),
		t1: tabsOf('https://flights.com'),
		l0: tabsOf('https://l.com'),
		'stash-1': tabsOf('https://docs.com/a'),
	}
}
