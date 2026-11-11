import { describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { restoreSnapshot } from '@/lib/restore'
import { parseVersion } from './model'
import { planMigration, type OldSavedSession, type OldStoreContent } from './migrate'

const NOW = Date.UTC(2026, 10, 11)

/** A tiny old TinyBase store: sessions with their tabs, and contexts pointing at them */
function oldStore(options: {
	contexts?: Record<string, { name: string; status?: string; head: string; updatedAt?: number }>
	sessions?: Record<
		string,
		{ contextId?: string; title?: string; createdAt?: number; urls: string[] }
	>
	active?: string
	parked?: string
}): OldStoreContent {
	const tables: Record<string, Record<string, Record<string, unknown>>> = {
		contexts: {},
		sessions: {},
		tabs: {},
		groups: {},
		windows: {},
	}
	for (const [id, ctx] of Object.entries(options.contexts ?? {})) {
		tables.contexts[id] = {
			name: ctx.name,
			color: 'blue',
			status: ctx.status ?? 'stashed',
			headSessionId: ctx.head,
			createdAt: 1000,
			updatedAt: ctx.updatedAt ?? 2000,
			sortOrder: 0,
		}
	}
	for (const [id, s] of Object.entries(options.sessions ?? {})) {
		tables.sessions[id] = {
			title: s.title ?? '',
			description: '',
			contextId: s.contextId ?? '',
			createdAt: s.createdAt ?? 1500,
			updatedAt: s.createdAt ?? 1500,
			reason: s.contextId ? 'head' : 'manual',
		}
		tables.windows[`${id}-win-7`] = {
			sessionId: id,
			originalId: 7,
			width: 1200,
			height: 800,
			left: 0,
			top: 0,
		}
		s.urls.forEach((url, index) => {
			// Rows are stored out of order on purpose; `index` decides
			tables.tabs[`${id}-tab-${s.urls.length - index}`] = {
				sessionId: id,
				stableId: `s${index}`,
				url,
				title: url,
				favIconUrl: '',
				windowId: 7,
				groupId: -1,
				active: index === 0,
				index,
			}
		})
	}
	return [
		tables,
		{ activeContextId: options.active ?? '', parkedContextId: options.parked ?? '' },
	]
}

const saved = (
	title: string,
	urls: string[],
	extra: Partial<OldSavedSession> = {},
): OldSavedSession => ({
	title,
	description: '',
	tabs: urls.map((url) => ({ url, title: url, windowId: 1, groupId: -1, active: false })),
	groups: [],
	windows: [{ id: 1, width: 1000, height: 700, left: 0, top: 0 }],
	...extra,
})

describe('planMigration: contexts', () => {
	const store = oldStore({
		contexts: {
			work: { name: 'Work', head: 'h1', updatedAt: 5000 },
			trip: { name: 'Trip', head: 'h2', status: 'archived' },
			parked: { name: 'Parked', head: 'h3' },
		},
		sessions: {
			h1: { contextId: 'work', createdAt: 4000, urls: ['https://a.com', 'https://b.com'] },
			old1: { contextId: 'work', createdAt: 3000, urls: ['https://a.com'] },
			old2: { contextId: 'work', createdAt: 3500, urls: ['https://z.com'] },
			h2: { contextId: 'trip', urls: ['https://flights.com'] },
			h3: { contextId: 'parked', urls: ['https://stale.com'] },
		},
		active: 'work',
		parked: 'parked',
	})
	const result = planMigration({ store, savedSessions: [], now: NOW })

	it('turns each context into a session, the active one open', () => {
		expect(result.sessions['context:work']).toMatchObject({
			name: 'Work',
			color: 'blue',
			status: 'open',
			kind: 'normal',
			tabCount: 2,
			origin: 'context',
			originId: 'work',
		})
		expect(result.sessions['context:trip'].status).toBe('archived')
		expect(result.sessions['context:parked'].kind).toBe('parked')
		expect(result.values).toEqual({
			openSessionId: 'context:work',
			parkedSessionId: 'context:parked',
			homeSessionId: '',
		})
		expect(result.report.created.home).toBe(false)
	})

	it('keeps snapshots as older versions, with the current tab set newest', () => {
		const work = Object.entries(result.versions)
			.filter(([, v]) => v.sessionId === 'context:work')
			.sort((a, b) => b[1].createdAt - a[1].createdAt)
		expect(work.map(([, v]) => [v.reason, v.tabCount])).toEqual([
			['migrated', 2],
			['switch', 1],
			['switch', 1],
		])
		expect(result.sessions['context:work'].headVersionId).toBe(work[0][0])
		// Tabs come back in their saved order, not row order
		expect(parseVersion(work[0][1]).tabs.map((t) => t.url)).toEqual([
			'https://a.com',
			'https://b.com',
		])
	})
})

describe('planMigration: saved sessions', () => {
	it('makes each a closed session, named from its title or sites, dated from its key', () => {
		const result = planMigration({
			store: oldStore({}),
			savedSessions: [
				[
					'08:35 am 09/24/2022',
					saved('Taxes', ['https://irs.gov/a', 'https://irs.gov/b'], {
						description: 'W-2s',
					}),
				],
				[
					'04:21 pm 10/05/2022',
					saved('', [
						'https://github.com/a',
						'https://github.com/b',
						'https://reddit.com',
						'https://x.com',
						'https://y.com',
					]),
				],
			],
			now: NOW,
		})
		const taxes = result.sessions['saved:08:35 am 09/24/2022']
		expect(taxes).toMatchObject({
			name: 'Taxes',
			description: 'W-2s',
			status: 'closed',
			tabCount: 2,
			origin: 'saved-session',
		})
		expect(new Date(taxes.createdAt).toISOString()).toMatch(/^2022-09-24T/)
		expect(result.sessions['saved:04:21 pm 10/05/2022'].name).toBe(
			'github.com, reddit.com +2 more',
		)
		// Nothing was active, so Home is the open session
		expect(result.values.openSessionId).toBe('home')
		expect(result.sessions.home).toMatchObject({
			kind: 'home',
			status: 'open',
			headVersionId: '',
		})
	})

	it('drops copies in the newer store, exact duplicates and empty sessions', () => {
		const result = planMigration({
			store: oldStore({
				sessions: {
					copy: { title: 'Taxes', urls: ['https://irs.gov/b', 'https://irs.gov/a'] },
					empty: { urls: [] },
					onlyHere: { title: 'From another device', urls: ['https://only.com'] },
				},
			}),
			savedSessions: [
				['08:35 am 09/24/2022', saved('Taxes', ['https://irs.gov/a', 'https://irs.gov/b'])],
				['09:00 am 09/25/2022', saved('Taxes', ['https://irs.gov/a', 'https://irs.gov/b'])],
				['10:00 am 09/26/2022', saved('', [])],
			],
			now: NOW,
		})
		expect(result.report.dropped).toEqual({ copies: 1, duplicates: 1, empty: 2 })
		// The newer of the two duplicates is kept
		expect(Object.keys(result.sessions).sort()).toEqual([
			'home',
			'saved:09:00 am 09/25/2022',
			'synced:onlyHere',
		])
	})

	it('ungroups tabs whose group was never saved and drops oversized data favicons', () => {
		const result = planMigration({
			store: oldStore({}),
			savedSessions: [
				[
					'08:35 am 09/24/2022',
					{
						title: 'G',
						tabs: [
							{
								url: 'https://a.com',
								windowId: 1,
								groupId: 5,
								favIconUrl: `data:image/png;base64,${'x'.repeat(5000)}`,
							},
							{
								url: 'https://b.com',
								windowId: 1,
								groupId: 99,
								favIconUrl: 'https://b.com/i.png',
							},
						],
						groups: [
							{ id: 5, title: 'Kept', color: 'red', collapsed: true, windowId: 1 },
							{
								id: 6,
								title: 'Unused',
								color: 'blue',
								collapsed: false,
								windowId: 1,
							},
						],
						windows: [],
					},
				],
			],
			now: NOW,
		})
		expect(result.report.fixed).toEqual({ missingGroups: 1, bigFavicons: 1 })
		const data = parseVersion(Object.values(result.versions)[0])
		expect(data.tabs.map((t) => [t.groupId, t.favIconUrl])).toEqual([
			[5, ''],
			[-1, 'https://b.com/i.png'],
		])
		expect(data.groups.map((g) => g.title)).toEqual(['Kept'])
	})
})

describe('planMigration: robustness', () => {
	it('gives the same result when run twice', () => {
		const input = {
			store: oldStore({
				contexts: { work: { name: 'Work', head: 'h1' } },
				sessions: { h1: { contextId: 'work', urls: ['https://a.com'] } },
			}),
			savedSessions: [
				['08:35 am 09/24/2022', saved('T', ['https://a.com', 'https://b.com'])],
			],
			now: NOW,
		}
		expect(planMigration(input)).toEqual(planMigration(input))
	})

	it('survives missing or malformed data', () => {
		const result = planMigration({
			store: undefined,
			savedSessions: { not: 'a list' },
			now: NOW,
		})
		expect(Object.keys(result.sessions)).toEqual(['home'])
		expect(result.report.created.sessions).toBe(1)
	})

	it('produces versions the restore engine can reopen', async () => {
		const fake = installFakeChrome()
		const result = planMigration({
			store: oldStore({}),
			savedSessions: [
				[
					'08:35 am 09/24/2022',
					saved('Docs', ['https://a.com', 'https://b.com', 'https://c.com'], {
						tabs: [
							{ url: 'https://a.com', windowId: 1, groupId: 3, active: false },
							{ url: 'https://b.com', windowId: 1, groupId: 3, active: true },
							{ url: 'https://c.com', windowId: 2, groupId: -1, active: false },
						],
						groups: [
							{ id: 3, title: 'Docs', color: 'green', collapsed: false, windowId: 1 },
						],
					}),
				],
			],
			now: NOW,
		})
		const session = result.sessions['saved:08:35 am 09/24/2022']
		await restoreSnapshot(parseVersion(result.versions[session.headVersionId]))
		expect(fake.snapshot().map((w) => w.tabs)).toEqual([
			[
				{ url: 'https://a.com', active: false, group: 'Docs/green/false' },
				{ url: 'https://b.com', active: true, group: 'Docs/green/false' },
			],
			[{ url: 'https://c.com', active: true, group: null }],
		])
	})
})
