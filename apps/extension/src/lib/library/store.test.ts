import { describe, expect, it } from 'vitest'
import { planMigration } from './migrate'
import { parsePreview, type SessionContent } from './model'
import {
	CAREFUL_CHECKPOINT_MS,
	MAX_CHECKPOINTS,
	ROUTINE_CHECKPOINT_MS,
	addCheckpoint,
	applyMigration,
	createLibrary,
	createSession,
	deleteSession,
	ensureHome,
	getCheckpointData,
	getOpenSessionId,
	getSession,
	getSessionData,
	isMigrated,
	listCheckpoints,
	listSessions,
	markOpen,
	referencedEntries,
	releaseEntries,
	restoreCheckpoint,
	setContent,
	setStatus,
	updateSession,
	type Library,
} from './store'

const data = (...urls: string[]): SessionContent => ({
	tabs: urls.map((url) => ({
		url,
		title: url,
		favIconUrl: `${url}/icon.png`,
		windowId: 1,
		groupId: -1,
		active: false,
	})),
	groups: [],
	windows: [{ id: 1, left: 0, top: 0, width: 1200, height: 800 }],
})

const HOUR = 60 * 60 * 1000
const urlsOf = (d: SessionContent | null) => d?.tabs.map((t) => t.url)
/** Every stored entry, and every entry the index refers to: always the same set */
async function expectSingleOwners(lib: Library) {
	const stored = (await lib.blobs.ids()).sort()
	expect(stored).toEqual([...referencedEntries(lib)].sort())
	const sessions = Object.values(lib.store.getTable('sessions'))
	const owners = [
		...sessions.map((s) => s.contentId).filter(Boolean),
		...Object.keys(lib.store.getTable('checkpoints')),
	]
	expect(new Set(owners).size).toBe(owners.length)
}

describe('library store', () => {
	it('takes a planned migration and lists it without opening contents', async () => {
		const lib = createLibrary()
		const result = planMigration({
			store: undefined,
			savedSessions: [
				[
					'08:35 am 09/24/2022',
					{ title: 'Old', tabs: [{ url: 'https://a.com', windowId: 1 }] },
				],
				[
					'08:35 am 09/24/2024',
					{ title: 'Newer', tabs: [{ url: 'https://b.com', windowId: 1 }] },
				],
			],
			now: 1_000,
		})
		expect(isMigrated(lib)).toBe(false)
		await applyMigration(lib, result, 2_000)
		// Applying again (another page at the same time) changes nothing
		await applyMigration(lib, result, 2_000)
		expect(isMigrated(lib)).toBe(true)
		// Most recently used first (Home was "opened" at the fake time 1000)
		expect(listSessions(lib).map((s) => s.name)).toEqual(['Newer', 'Old', 'Home'])
		expect(listSessions(lib, { status: 'closed' }).map((s) => s.name)).toEqual(['Newer', 'Old'])
		// The planned open session becomes this device's, and the index no longer says it
		expect(getOpenSessionId(lib)).toBe('home')
		expect(getSession(lib, 'home')?.status).toBe('open')
		expect(lib.store.getValues()).toEqual({ schemaVersion: 4, migratedAt: 2_000 })
		for (const row of Object.values(lib.store.getTable('sessions'))) {
			expect(row).not.toHaveProperty('status')
			expect(row).not.toHaveProperty('headVersionId')
		}
		const newer = listSessions(lib, { status: 'closed' })[0]
		expect(urlsOf(await getSessionData(lib, newer.id))).toEqual(['https://b.com'])
		// Each saved session's only version is its content; none is a checkpoint
		expect(lib.store.getTable('versions')).toEqual({})
		expect(lib.store.getTable('checkpoints')).toEqual({})
		expect(await lib.blobs.ids()).toHaveLength(2)
		await expectSingleOwners(lib)
	})

	it('creates a session with its content and a preview', async () => {
		const lib = createLibrary()
		const id = await createSession(
			lib,
			{ name: 'Taxes' },
			data('https://irs.gov', 'https://irs.gov/b', 'https://x.com'),
			100,
		)
		expect(getSession(lib, id)).toMatchObject({ name: 'Taxes', status: 'closed', tabCount: 3 })
		expect(getSession(lib, id)?.contentId).toBeTruthy()
		expect(parsePreview(getSession(lib, id)!.preview).map((p) => p.url)).toEqual([
			'https://irs.gov',
			'https://x.com',
		])
		expect(listCheckpoints(lib, id)).toEqual([])
		const empty = await createSession(lib, { name: 'Fresh' })
		expect(getSession(lib, empty)).toMatchObject({ contentId: '', tabCount: 0 })
	})

	it('keeps one session open at a time, on this device only', async () => {
		const lib = createLibrary()
		const a = await createSession(lib, { name: 'A' })
		const b = await createSession(lib, { name: 'B' })
		await markOpen(lib, a, 10)
		await markOpen(lib, b, 20)
		expect(getSession(lib, a)?.status).toBe('closed')
		expect(getSession(lib, b)).toMatchObject({ status: 'open', lastOpenedAt: 20 })
		expect(getOpenSessionId(lib)).toBe(b)
		expect(listSessions(lib, { status: 'open' }).map((s) => s.id)).toEqual([b])
		// Nothing about it is in the index
		expect(lib.store.getValues()).toEqual({ schemaVersion: 0, migratedAt: 0 })
		expect(lib.store.getRow('sessions', b)).not.toHaveProperty('status')
	})

	it('archives: the open session closes on this device; others stay as they are', async () => {
		const lib = createLibrary()
		const a = await createSession(lib, { name: 'A' })
		const b = await createSession(lib, { name: 'B' })
		await markOpen(lib, b)
		await lib.runtime.set({ link: 'linked' })
		await setStatus(lib, a, 'archived', 50)
		expect(getSession(lib, a)).toMatchObject({ status: 'archived', archivedAt: 50 })
		expect(getOpenSessionId(lib)).toBe(b)
		expect(lib.runtime.get().link).toBe('linked')
		await setStatus(lib, b, 'archived', 60)
		expect(getOpenSessionId(lib)).toBe('')
		// Its tabs are still open: whether they are Home's is decided afresh
		expect(lib.runtime.get().link).toBe('unknown')
		expect(getSession(lib, b)).toMatchObject({ status: 'archived', archivedAt: 60 })
		await setStatus(lib, a, 'closed')
		expect(getSession(lib, a)).toMatchObject({ status: 'closed', archivedAt: 0 })
		expect(listSessions(lib, { status: 'archived' }).map((s) => s.id)).toEqual([b])
	})

	it('renames, and deletes a session with everything it owns', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'Old name' }, data('https://a.com'))
		await setContent(lib, id, data('https://b.com'), 'always')
		const other = await createSession(lib, { name: 'Other' }, data('https://other.com'))
		updateSession(lib, id, { name: 'New name', description: 'notes' })
		expect(getSession(lib, id)).toMatchObject({ name: 'New name', description: 'notes' })
		await markOpen(lib, id)
		expect(await lib.blobs.ids()).toHaveLength(3)
		await deleteSession(lib, id)
		expect(getSession(lib, id)).toBeNull()
		expect(lib.store.getTable('checkpoints')).toEqual({})
		expect(await lib.blobs.ids()).toEqual([getSession(lib, other)!.contentId])
		expect(getOpenSessionId(lib)).toBe('')
	})

	it('deleting a session that is not open leaves the open one', async () => {
		const lib = createLibrary()
		const a = await createSession(lib, { name: 'A' })
		const b = await createSession(lib, { name: 'B' })
		await markOpen(lib, a)
		await deleteSession(lib, b)
		expect(getOpenSessionId(lib)).toBe(a)
	})

	it('moves a planned Parked session in as an ordinary one', async () => {
		const lib = createLibrary()
		const result = planMigration({
			store: undefined,
			savedSessions: [],
			parkQueue: [{ url: 'https://later.com' }],
			now: 1_000,
		})
		expect(result.sessions.parked.kind).toBe('parked')
		await applyMigration(lib, result, 2_000)
		expect(getSession(lib, 'parked')).toMatchObject({ kind: 'normal', tabCount: 1 })
	})

	it('creates Home once, when first needed', () => {
		const lib = createLibrary()
		expect(ensureHome(lib)).toBe('home')
		expect(lib.store.getValues()).toEqual({ schemaVersion: 0, migratedAt: 0 })
		updateSession(lib, 'home', { description: 'kept' })
		ensureHome(lib)
		expect(getSession(lib, 'home')).toMatchObject({
			name: 'Home',
			kind: 'home',
			description: 'kept',
		})
	})
})

describe('setContent', () => {
	async function sessionWith(...urls: string[]) {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'S' }, data(...urls), 0)
		return { lib, id }
	}

	it('does nothing when the content is unchanged', async () => {
		const { lib, id } = await sessionWith('https://a.com')
		const before = structuredClone(lib.store.getMergeableContent())
		const write = await setContent(lib, id, data('https://a.com'), 'always', { now: 5 })
		expect(write).toEqual({ changed: false, checkpointId: null })
		expect(lib.store.getMergeableContent()).toEqual(before)
		expect(await lib.blobs.ids()).toHaveLength(1)
		// Nor for an empty session written empty
		const empty = await createSession(lib, { name: 'E' })
		expect(
			(await setContent(lib, empty, { tabs: [], groups: [], windows: [] }, 'always')).changed,
		).toBe(false)
	})

	it('writes the new entry before the session points at it, and points at it with its counts', async () => {
		const { lib, id } = await sessionWith('https://a.com')
		const order: string[] = []
		const set = lib.blobs.set
		lib.blobs.set = async (entries) => {
			order.push(`entry ${Object.keys(entries)[0]}`)
			return set(entries)
		}
		lib.store.addCellListener('sessions', id, 'contentId', (_s, _t, _r, _c, value) =>
			order.push(`index ${value}`),
		)
		await setContent(lib, id, data('https://b.com', 'https://c.com'), 'never', { now: 7 })
		const contentId = getSession(lib, id)!.contentId
		expect(order).toEqual([`entry ${contentId}`, `index ${contentId}`])
		expect(getSession(lib, id)).toMatchObject({ tabCount: 2, updatedAt: 7 })
		expect(parsePreview(getSession(lib, id)!.preview).map((p) => p.url)).toEqual([
			'https://b.com',
			'https://c.com',
		])
	})

	it('deletes what it replaces only once the index no longer refers to it', async () => {
		const { lib, id } = await sessionWith('https://a.com')
		const old = getSession(lib, id)!.contentId
		const seen: (string | undefined)[] = []
		lib.dropEntries = async (ids) => {
			// What the index says at the moment of deleting
			seen.push(...ids.map(() => getSession(lib, id)?.contentId))
			await lib.blobs.delete(ids)
		}
		await setContent(lib, id, data('https://b.com'), 'never')
		expect(seen).toHaveLength(1)
		expect(seen[0]).not.toBe(old)
		expect(await lib.blobs.get(old)).toBeNull()
	})

	it('routine: keeps what it replaces when the newest checkpoint is over an hour old', async () => {
		const { lib, id } = await sessionWith('https://v0.com')
		const first = getSession(lib, id)!.contentId
		// No checkpoint yet: the first replaced content becomes one
		let write = await setContent(lib, id, data('https://v1.com'), 'routine', { now: HOUR })
		expect(write.checkpointId).toBe(first)
		expect(listCheckpoints(lib, id)).toEqual([
			expect.objectContaining({
				id: first,
				createdAt: HOUR,
				reason: 'autosave',
				tabCount: 1,
			}),
		])
		expect(urlsOf(await getCheckpointData(lib, first))).toEqual(['https://v0.com'])
		// Within the hour: replaced and deleted
		const second = getSession(lib, id)!.contentId
		write = await setContent(lib, id, data('https://v2.com'), 'routine', { now: 2 * HOUR })
		expect(write.checkpointId).toBeNull()
		expect(await lib.blobs.get(second)).toBeNull()
		// Past it: kept
		write = await setContent(lib, id, data('https://v3.com'), 'routine', {
			now: 2 * HOUR + ROUTINE_CHECKPOINT_MS,
		})
		expect(write.checkpointId).toBeTruthy()
		expect(listCheckpoints(lib, id).map((c) => c.createdAt)).toEqual([3 * HOUR, HOUR])
		await expectSingleOwners(lib)
	})

	it('careful: keeps what it replaces unless a checkpoint was made in the last 5 minutes', async () => {
		const { lib, id } = await sessionWith('https://v0.com')
		const t = 10 * HOUR
		expect(
			(await setContent(lib, id, data('https://v1.com'), 'careful', { now: t })).checkpointId,
		).toBeTruthy()
		expect(
			(await setContent(lib, id, data('https://v2.com'), 'careful', { now: t + 60_000 }))
				.checkpointId,
		).toBeNull()
		expect(
			(
				await setContent(lib, id, data('https://v3.com'), 'careful', {
					now: t + CAREFUL_CHECKPOINT_MS,
					reason: 'edit',
				})
			).checkpointId,
		).toBeTruthy()
		expect(listCheckpoints(lib, id).map((c) => c.reason)).toEqual(['edit', 'autosave'])
		await expectSingleOwners(lib)
	})

	it('always and never', async () => {
		const { lib, id } = await sessionWith('https://v0.com')
		for (let i = 1; i <= 3; i++) {
			await setContent(lib, id, data(`https://v${i}.com`), 'always', { now: i })
		}
		expect(listCheckpoints(lib, id)).toHaveLength(3)
		await setContent(lib, id, data('https://v4.com'), 'never', { now: 10 })
		expect(listCheckpoints(lib, id)).toHaveLength(3)
		expect(await lib.blobs.ids()).toHaveLength(4)
		await expectSingleOwners(lib)
	})

	it('empty content never becomes a checkpoint, and an empty session points at nothing', async () => {
		const { lib, id } = await sessionWith('https://v0.com')
		const first = getSession(lib, id)!.contentId
		await setContent(lib, id, { tabs: [], groups: [], windows: [] }, 'never', { now: 1 })
		expect(getSession(lib, id)).toMatchObject({ contentId: '', tabCount: 0, preview: '[]' })
		expect(await lib.blobs.get(first)).toBeNull()
		expect(await getSessionData(lib, id)).toBeNull()
		await setContent(lib, id, data('https://v1.com'), 'always', { now: 2 })
		expect(listCheckpoints(lib, id)).toEqual([])
		// Nor does content of blank and new tab pages only
		await setContent(lib, id, data('chrome://newtab/', 'about:blank'), 'never', { now: 3 })
		await setContent(lib, id, data('https://v2.com'), 'always', { now: 4 })
		expect(listCheckpoints(lib, id)).toEqual([])
		expect(await addCheckpoint(lib, id, 'manual', 5)).toBeTruthy()
		await setContent(lib, id, data('chrome://newtab/'), 'never', { now: 6 })
		expect(await addCheckpoint(lib, id, 'manual', 7)).toBeNull()
		await expectSingleOwners(lib)
	})

	it(`keeps the newest ${MAX_CHECKPOINTS} checkpoints and deletes the rest with their entries`, async () => {
		const { lib, id } = await sessionWith('https://v0.com')
		for (let i = 1; i <= 13; i++) {
			await setContent(lib, id, data(`https://v${i}.com`, 'https://x.com'), 'always', {
				now: i,
			})
		}
		const checkpoints = listCheckpoints(lib, id)
		expect(checkpoints).toHaveLength(MAX_CHECKPOINTS)
		expect(checkpoints[0].createdAt).toBe(13)
		expect(checkpoints.at(-1)!.createdAt).toBe(4)
		// The oldest kept holds v3: it was replaced at time 4
		expect(urlsOf(await getCheckpointData(lib, checkpoints.at(-1)!.id))?.[0]).toBe(
			'https://v3.com',
		)
		expect(await lib.blobs.ids()).toHaveLength(MAX_CHECKPOINTS + 1)
		expect(urlsOf(await getSessionData(lib, id))?.[0]).toBe('https://v13.com')
		await expectSingleOwners(lib)
	})

	it('a second session never takes another session’s checkpoints', async () => {
		const lib = createLibrary()
		const a = await createSession(lib, { name: 'A' }, data('https://a0.com'), 0)
		const b = await createSession(lib, { name: 'B' }, data('https://b0.com'), 0)
		for (let i = 1; i <= 12; i++) {
			await setContent(lib, a, data(`https://a${i}.com`), 'always', { now: i })
		}
		await setContent(lib, b, data('https://b1.com'), 'always', { now: 20 })
		expect(listCheckpoints(lib, a)).toHaveLength(MAX_CHECKPOINTS)
		expect(listCheckpoints(lib, b)).toHaveLength(1)
		await expectSingleOwners(lib)
	})

	it('refuses a session that is gone', async () => {
		const lib = createLibrary()
		await expect(setContent(lib, 'nope', data('https://a.com'), 'never')).rejects.toThrow(
			/no longer exists/,
		)
		expect(await lib.blobs.ids()).toEqual([])
	})
})

describe('checkpoints', () => {
	it('keeps a copy of the content by hand, owning its own entry', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'S' }, data('https://a.com'), 0)
		const checkpoint = await addCheckpoint(lib, id, 'manual', 5)
		expect(checkpoint).toBeTruthy()
		expect(checkpoint).not.toBe(getSession(lib, id)!.contentId)
		expect(listCheckpoints(lib, id)).toEqual([
			expect.objectContaining({ id: checkpoint, reason: 'manual', createdAt: 5 }),
		])
		expect(urlsOf(await getCheckpointData(lib, checkpoint!))).toEqual(['https://a.com'])
		await expectSingleOwners(lib)
		// Nothing to keep in an empty session
		const empty = await createSession(lib, { name: 'E' })
		expect(await addCheckpoint(lib, empty, 'manual')).toBeNull()
	})

	it('restores one into a closed session: what it replaces is kept, and it stays', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'S' }, data('https://first.com'), 1)
		await setContent(lib, id, data('https://second.com'), 'always', { now: 2 })
		const [first] = listCheckpoints(lib, id)
		await restoreCheckpoint(lib, id, first.id, 3)
		expect(urlsOf(await getSessionData(lib, id))).toEqual(['https://first.com'])
		expect(listCheckpoints(lib, id).map((c) => [c.reason, c.tabCount])).toEqual([
			['restore', 1],
			['autosave', 1],
		])
		expect(urlsOf(await getCheckpointData(lib, listCheckpoints(lib, id)[0].id))).toEqual([
			'https://second.com',
		])
		// The restored one stays, with its own entry
		expect(listCheckpoints(lib, id)[1].id).toBe(first.id)
		expect(getSession(lib, id)!.contentId).not.toBe(first.id)
		await expectSingleOwners(lib)
	})

	it('restoring the oldest of a full list keeps it', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'S' }, data('https://v0.com'), 0)
		for (let i = 1; i <= MAX_CHECKPOINTS; i++) {
			await setContent(lib, id, data(`https://v${i}.com`), 'always', { now: i })
		}
		const oldest = listCheckpoints(lib, id).at(-1)!
		await restoreCheckpoint(lib, id, oldest.id, 100)
		const kept = listCheckpoints(lib, id)
		expect(kept).toHaveLength(MAX_CHECKPOINTS)
		expect(kept.map((c) => c.id)).toContain(oldest.id)
		expect(urlsOf(await getSessionData(lib, id))).toEqual(['https://v0.com'])
		await expectSingleOwners(lib)
	})

	it("refuses another session's checkpoint, or one that is gone", async () => {
		const lib = createLibrary()
		const a = await createSession(lib, { name: 'A' }, data('https://a.com'), 0)
		const b = await createSession(lib, { name: 'B' }, data('https://b.com'), 0)
		await setContent(lib, a, data('https://a2.com'), 'always', { now: 1 })
		const [checkpoint] = listCheckpoints(lib, a)
		await expect(restoreCheckpoint(lib, b, checkpoint.id)).rejects.toThrow(/no longer kept/)
		await expect(restoreCheckpoint(lib, a, 'nope')).rejects.toThrow(/no longer kept/)
		expect(urlsOf(await getSessionData(lib, b))).toEqual(['https://b.com'])
	})

	it('never deletes an entry something still refers to', async () => {
		const lib = createLibrary()
		const id = await createSession(lib, { name: 'S' }, data('https://a.com'), 0)
		const contentId = getSession(lib, id)!.contentId
		await releaseEntries(lib, [contentId, 'unknown'])
		expect(await lib.blobs.get(contentId)).not.toBeNull()
	})
})
