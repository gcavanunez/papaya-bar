import { describe, expect, it } from 'vitest'
import {
	buildPrompt,
	groupBySite,
	groupOnDevice,
	mergeSuggestions,
	parseReply,
	siteLabel,
	suggestGroups,
	type GroupableTab,
	type LanguageModelApi,
} from './smartGroup'

const tab = (id: number, url: string, title = `Tab ${id}`): GroupableTab => ({ id, url, title })

describe('siteLabel', () => {
	it('uses the hostname without www', () => {
		expect(siteLabel('https://www.github.com/vuejs/core')).toBe('github.com')
		expect(siteLabel('http://docs.google.com/x')).toBe('docs.google.com')
	})

	it('labels browser pages and files, and skips the rest', () => {
		expect(siteLabel('chrome://extensions')).toBe('Browser pages')
		expect(siteLabel('file:///Users/me/a.pdf')).toBe('Files')
		expect(siteLabel('chrome-extension://abc/index.html')).toBeNull()
		expect(siteLabel('not a url')).toBeNull()
		expect(siteLabel(undefined)).toBeNull()
	})
})

describe('groupBySite', () => {
	it('groups sites with at least two tabs, biggest first', () => {
		const result = groupBySite([
			tab(1, 'https://github.com/a'),
			tab(2, 'https://news.ycombinator.com'),
			tab(3, 'https://github.com/b'),
			tab(4, 'https://en.wikipedia.org/wiki/A'),
			tab(5, 'https://www.github.com/c'),
			tab(6, 'https://en.wikipedia.org/wiki/B'),
		])
		expect(result).toEqual([
			{ name: 'github.com', tabIds: [1, 3, 5] },
			{ name: 'en.wikipedia.org', tabIds: [4, 6] },
		])
	})
})

describe('mergeSuggestions', () => {
	it('merges names ignoring case and gives each tab to its first group', () => {
		const result = mergeSuggestions([
			{ name: 'Rust', tabIds: [1, 2] },
			{ name: 'Travel', tabIds: [2, 3, 4] },
			{ name: 'rust', tabIds: [5] },
			{ name: 'Solo', tabIds: [6] },
		])
		expect(result).toEqual([
			{ name: 'Rust', tabIds: [1, 2, 5] },
			{ name: 'Travel', tabIds: [3, 4] },
		])
	})
})

describe('parseReply', () => {
	const ids = [101, 102, 103, 104]

	it('maps tab numbers back to ids', () => {
		const reply = JSON.stringify({ groups: [{ name: ' Rust  book ', tabs: [1, 3] }] })
		expect(parseReply(reply, ids)).toEqual([{ name: 'Rust book', tabIds: [101, 103] }])
	})

	it('drops unknown numbers, repeats, and groups without a name', () => {
		const reply = JSON.stringify({
			groups: [
				{ name: 'A', tabs: [1, 1, 9, 0, 2.5, '3', 2] },
				{ name: 'B', tabs: [2, 4] },
				{ name: '', tabs: [3] },
				{ name: 'C', tabs: [] },
			],
		})
		expect(parseReply(reply, ids)).toEqual([
			{ name: 'A', tabIds: [101, 102] },
			{ name: 'B', tabIds: [104] },
		])
	})

	it('returns nothing for malformed replies', () => {
		expect(parseReply('not json', ids)).toEqual([])
		expect(parseReply('{"groups": 3}', ids)).toEqual([])
		expect(parseReply('null', ids)).toEqual([])
	})
})

describe('buildPrompt', () => {
	it('numbers tabs from 1 and lists names found so far', () => {
		const prompt = buildPrompt(
			[tab(55, 'https://github.com/x', 'Issue   #4'), { id: 56, url: 'https://a.com/p' }],
			['Rust'],
		)
		expect(prompt).toContain('1. Issue #4 (github.com)')
		expect(prompt).toContain('2. https://a.com/p (a.com)')
		expect(prompt).toContain('Reuse a name when a tab fits it: Rust')
		expect(prompt).not.toContain('55')
	})
})

/** A fake Prompt API: groups each batch's tabs by the first word of their title. */
function fakeModel(options: { status?: string; maxTabs?: number; fail?: boolean } = {}) {
	const prompts: string[] = []
	let destroyed = 0
	const session = {
		async prompt(input: string) {
			prompts.push(input)
			if (options.fail) throw new Error('model crashed')
			const lines = input.split('\n').filter((line) => /^\d+\. /.test(line))
			if (options.maxTabs && lines.length > options.maxTabs) {
				throw Object.assign(new Error('too big'), { name: 'QuotaExceededError' })
			}
			const groups = new Map<string, number[]>()
			for (const line of lines) {
				const [n, word] = line.split(/\.? /)
				groups.set(word, [...(groups.get(word) ?? []), Number(n)])
			}
			return JSON.stringify({ groups: [...groups].map(([name, tabs]) => ({ name, tabs })) })
		},
		async clone() {
			return session
		},
		destroy() {
			destroyed++
		},
	}
	const lm = {
		availability: async () => options.status ?? 'available',
		create: async () => session,
	} as unknown as LanguageModelApi
	return { lm, prompts, destroyed: () => destroyed }
}

const pile = (count: number) =>
	Array.from({ length: count }, (_, i) =>
		tab(i + 1, `https://site${i % 3}.com/${i}`, `${i % 2 ? 'Rust' : 'Taxes'} page ${i}`),
	)

describe('groupOnDevice', () => {
	it('batches tabs and merges groups across batches', async () => {
		const { lm, prompts } = fakeModel()
		const progress: number[] = []
		const result = await groupOnDevice(pile(7), {
			lm,
			batchSize: 3,
			onProgress: (done) => progress.push(done),
		})
		expect(prompts).toHaveLength(3)
		expect(progress).toEqual([3, 6, 7])
		expect(prompts[1]).toContain('Groups so far. Reuse a name when a tab fits it: Taxes, Rust')
		expect(result).toEqual([
			{ name: 'Taxes', tabIds: [1, 3, 5, 7] },
			{ name: 'Rust', tabIds: [2, 4, 6] },
		])
	})

	it('splits a batch that overflows the context window', async () => {
		const { lm, prompts } = fakeModel({ maxTabs: 2 })
		const result = await groupOnDevice(pile(4), { lm, batchSize: 4 })
		// 4 fails, then 2 + 2 succeed
		expect(prompts).toHaveLength(3)
		expect(result.flatMap((s) => s.tabIds).sort()).toEqual([1, 2, 3, 4])
	})
})

describe('suggestGroups', () => {
	it('leaves out blank and new tab pages', async () => {
		const tabs = [
			tab(1, 'chrome://newtab/'),
			tab(2, 'chrome://newtab/'),
			tab(3, 'about:blank'),
			{ id: 4 },
			tab(5, 'https://a.com/1'),
			tab(6, 'https://a.com/2'),
		]
		const { lm, prompts } = fakeModel()
		await suggestGroups(tabs, { lm })
		expect(prompts[0]).not.toMatch(/newtab|blank/)
		expect(prompts[0].split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(2)
		const bySite = await suggestGroups(tabs, { engine: 'site' })
		expect(bySite.suggestions).toEqual([{ name: 'a.com', tabIds: [5, 6] }])
	})

	it('uses the on-device model when it is available', async () => {
		const { lm } = fakeModel()
		const result = await suggestGroups(pile(4), { lm })
		expect(result.engine).toBe('on-device')
	})

	it('groups by site when the model is missing, not downloaded, or not wanted', async () => {
		expect((await suggestGroups(pile(6), { lm: null })).engine).toBe('site')
		expect(
			(await suggestGroups(pile(6), { lm: fakeModel({ status: 'downloadable' }).lm })).engine,
		).toBe('site')
		expect((await suggestGroups(pile(6), { lm: fakeModel().lm, engine: 'site' })).engine).toBe(
			'site',
		)
	})

	it('falls back to by site with a reason when the model fails', async () => {
		const { lm, destroyed } = fakeModel({ fail: true })
		const result = await suggestGroups(pile(6), { lm })
		expect(result.engine).toBe('site')
		expect(result.fallbackReason).toBe('model crashed')
		expect(result.suggestions).toHaveLength(3)
		expect(destroyed()).toBeGreaterThan(0)
	})
})
