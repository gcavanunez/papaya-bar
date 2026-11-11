/**
 * Dry run of the migration against a real backup file. Skipped unless a path is given:
 *
 *   PAPAYA_BACKUP=~/Downloads/papaya-backup-2026-11-11.json pnpm test dryrun
 *
 * Prints the report and checks that nothing is lost on the way.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import { restoreSnapshot } from '@/lib/restore'
import { parseVersion } from './model'
import { planMigration, type OldSavedSession } from './migrate'
import { applyMigration, createLibrary, listSessions } from './store'

const path = process.env.PAPAYA_BACKUP?.replace(/^~/, process.env.HOME ?? '~')

describe.skipIf(!path)('migration dry run on a real backup', () => {
	const backup = path ? JSON.parse(readFileSync(path, 'utf8')) : null
	const savedSessions = (backup?.legacySessions ?? []) as [string, OldSavedSession][]
	const started = performance.now()
	const result = backup ? planMigration({ store: backup.tinybase, savedSessions }) : null
	const ms = Math.round(performance.now() - started)

	it('prints the report', () => {
		const { report } = result!
		console.log(
			JSON.stringify(
				{
					...report,
					oldest: report.oldest && new Date(report.oldest).toISOString().slice(0, 10),
					newest: report.newest && new Date(report.newest).toISOString().slice(0, 10),
					megabytes: +(report.bytes / 1e6).toFixed(1),
					ms,
				},
				null,
				2,
			),
		)
	})

	it('accounts for every saved session', () => {
		const { report, sessions } = result!
		const kept = Object.values(sessions).filter((s) => s.origin === 'saved-session').length
		const emptySaved = savedSessions.filter(([, s]) => !s.tabs?.length).length
		expect(kept + report.dropped.duplicates + emptySaved).toBe(savedSessions.length)
	})

	it('keeps every tab of every kept saved session', () => {
		const { sessions } = result!
		for (const session of Object.values(sessions)) {
			if (session.origin !== 'saved-session') continue
			const original = savedSessions.find(([key]) => key === session.originId)![1]
			expect(session.tabCount).toBe(original.tabs!.length)
		}
	})

	it('gives every session a readable newest version that matches its counts', () => {
		const { sessions, versions } = result!
		for (const [id, session] of Object.entries(sessions)) {
			if (!session.headVersionId) {
				expect(session.tabCount).toBe(0)
				continue
			}
			const head = versions[session.headVersionId]
			expect(head.sessionId).toBe(id)
			const data = parseVersion(head)
			expect(data.tabs).toHaveLength(session.tabCount)
			const groupIds = new Set(data.groups.map((g) => g.id))
			for (const tab of data.tabs) {
				expect(tab.groupId === -1 || groupIds.has(tab.groupId)).toBe(true)
			}
		}
	})

	it('loads into the library and lists quickly', async () => {
		const lib = createLibrary()
		await applyMigration(lib, result!)
		const indexBytes = JSON.stringify(lib.store.getMergeableContent()).length
		console.log(`library index: ${(indexBytes / 1e3).toFixed(0)} kB`)
		expect(indexBytes).toBeLessThan(1_000_000)
		const started = performance.now()
		const sessions = listSessions(lib)
		const listMs = performance.now() - started
		console.log(`listed ${sessions.length} sessions in ${listMs.toFixed(1)} ms`)
		expect(sessions).toHaveLength(Object.keys(result!.sessions).length)
		expect(listMs).toBeLessThan(50)
	})

	it('reopens the largest session completely', async () => {
		const { sessions, versions } = result!
		const largest = Object.values(sessions).sort((a, b) => b.tabCount - a.tabCount)[0]
		const data = parseVersion(versions[largest.headVersionId])
		const fake = installFakeChrome()
		const restored = await restoreSnapshot(data)
		const opened = fake.snapshot().flatMap((w) => w.tabs)
		expect(restored.failed).toEqual([])
		expect(opened).toHaveLength(largest.tabCount)
		expect(opened.map((t) => t.url)).toEqual(
			// Tabs reopen grouped by window, in their saved order within each window
			[...new Set(data.tabs.map((t) => t.windowId))].flatMap((w) =>
				data.tabs.filter((t) => t.windowId === w).map((t) => t.url || 'chrome://newtab/'),
			),
		)
	})
})
