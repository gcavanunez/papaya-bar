/**
 * A library index as schema 1 wrote it, built with that schema, so upgrade tests start
 * from what is really stored on people's browsers.
 */
import { createMergeableStore } from 'tinybase'

export function createV1Store() {
	const store = createMergeableStore('papaya-library')
	store.setTablesSchema({
		sessions: {
			name: { type: 'string', default: '' },
			description: { type: 'string', default: '' },
			color: { type: 'string', default: 'grey' },
			kind: { type: 'string', default: 'normal' },
			status: { type: 'string', default: 'closed' },
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
		openSessionId: { type: 'string', default: '' },
		parkedSessionId: { type: 'string', default: '' },
		homeSessionId: { type: 'string', default: '' },
		schemaVersion: { type: 'number', default: 0 },
		migratedAt: { type: 'number', default: 0 },
	})
	return store
}

const session = (fields: Record<string, string | number>) => ({
	description: '',
	color: 'grey',
	kind: 'normal',
	status: 'closed',
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

/**
 * A moved-in library: Work open, Trip archived, a Parked session, a closed saved
 * session with a version, Home, and a stashed group
 */
export function sampleV1Store() {
	const store = createV1Store()
	store.transaction(() => {
		store.setRow(
			'sessions',
			'ctx-work',
			session({ name: 'Work', status: 'open', lastOpenedAt: 300, headVersionId: 'w1' }),
		)
		store.setRow(
			'sessions',
			'ctx-trip',
			session({ name: 'Trip', status: 'archived', updatedAt: 250, color: 'blue' }),
		)
		store.setRow('sessions', 'parked', session({ name: 'Parked', kind: 'parked' }))
		store.setRow(
			'sessions',
			'saved-a',
			session({ name: 'Saved', origin: 'saved-session', headVersionId: 's1', tabCount: 1 }),
		)
		store.setRow(
			'sessions',
			'home',
			session({ name: 'Home', kind: 'home', origin: 'home', description: 'notes' }),
		)
		store.setRow('versions', 'w1', { sessionId: 'ctx-work', createdAt: 150, reason: 'switch' })
		store.setRow('versions', 's1', {
			sessionId: 'saved-a',
			createdAt: 120,
			reason: 'migrated',
			tabCount: 1,
			windowCount: 1,
		})
		store.setRow('stashed', 'stash-1', {
			sessionId: 'ctx-work',
			name: 'Docs',
			color: 'blue',
			tabCount: 2,
			createdAt: 160,
		})
		store.setValues({
			openSessionId: 'ctx-work',
			parkedSessionId: 'parked',
			homeSessionId: 'home',
			schemaVersion: 1,
			migratedAt: 90,
		})
	})
	return store
}
