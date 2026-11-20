import { describe, expect, it } from 'vitest'
import {
	buildPrompt,
	groupBySite,
	groupOnDevice,
	groupWithOpencode,
	isGroupsReply,
	mergeSuggestions,
	opencodeBatchSize,
	parseReply,
	RETRY_NOTE,
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

	it('finds the JSON when a model wraps it in prose or a code fence', () => {
		const wrapped = 'Here you go:\n```json\n{"groups":[{"name":"A","tabs":[1,2]}]}\n```\nDone.'
		expect(parseReply(wrapped, ids)).toEqual([{ name: 'A', tabIds: [101, 102] }])
	})

	it('returns nothing for malformed replies', () => {
		expect(parseReply('not json', ids)).toEqual([])
		expect(parseReply('{"groups": 3}', ids)).toEqual([])
		expect(parseReply('null', ids)).toEqual([])
		expect(isGroupsReply('not json')).toBe(false)
		expect(isGroupsReply('{"groups": 3}')).toBe(false)
		// No groups is still an answer: the tabs have nothing in common
		expect(isGroupsReply('Here: {"groups": []}')).toBe(true)
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
		expect(result.fallbackReason).toBe('on-device model: model crashed')
		expect(result.suggestions).toHaveLength(3)
		expect(destroyed()).toBeGreaterThan(0)
	})
})

describe('the opencode engine', () => {
	/**
	 * A fake opencode model: groups by the first word of each title, like the fake above.
	 * `prose` replies that many times without the JSON first.
	 */
	function fakeOpencode(options: { fail?: string; prose?: number } = {}) {
		const prompts: string[] = []
		let prose = options.prose ?? 0
		const ask = async (prompt: string) => {
			prompts.push(prompt)
			if (options.fail) throw new Error(options.fail)
			if (prose-- > 0) return 'These tabs are about Rust and taxes.'
			const groups = new Map<string, number[]>()
			for (const line of prompt.split('\n').filter((l) => /^\d+\. /.test(l))) {
				const [n, word] = line.split(/\.? /)
				groups.set(word, [...(groups.get(word) ?? []), Number(n)])
			}
			// Hosted models like to explain themselves
			return `Sure!\n${JSON.stringify({ groups: [...groups].map(([name, tabs]) => ({ name, tabs })) })}`
		}
		return { ask, prompts }
	}

	it('is preferred when connected, and sends instructions with each batch', async () => {
		const opencode = fakeOpencode()
		const result = await suggestGroups(pile(6), { opencode: opencode.ask, lm: fakeModel().lm })
		expect(result.engine).toBe('opencode')
		expect(result.suggestions.map((s) => s.name).sort()).toEqual(['Rust', 'Taxes'])
		expect(opencode.prompts[0]).toContain('Reply only with JSON')
		expect(opencode.prompts[0]).toContain('{"groups":[{"name":"...","tabs":[1,2]}]}')
	})

	it("sends big piles in batches of 150 when the model's limits aren't known", async () => {
		const opencode = fakeOpencode()
		await groupWithOpencode(pile(320), opencode.ask)
		expect(opencode.prompts).toHaveLength(3)
	})

	it('sends every tab at once when the model has room for them', async () => {
		const opencode = fakeOpencode()
		const limits = { context: 200_000, output: 32_000 }
		const result = await suggestGroups(pile(320), {
			opencode: opencode.ask,
			opencodeLimits: limits,
		})
		expect(opencode.prompts).toHaveLength(1)
		expect(result.suggestions.flatMap((s) => s.tabIds)).toHaveLength(320)
	})

	it('sizes batches by what the model reads and writes at once', () => {
		expect(opencodeBatchSize()).toBe(150)
		// A quarter of the context, at about 40 tokens a tab
		expect(opencodeBatchSize({ context: 200_000, output: 32_000 })).toBe(1250)
		expect(opencodeBatchSize({ context: 32_000 })).toBe(200)
		// Half the reply, at about 4 tokens a tab
		expect(opencodeBatchSize({ context: 1_000_000, output: 8192 })).toBe(1024)
		// Never smaller than the on-device batch
		expect(opencodeBatchSize({ context: 4096 })).toBe(30)
	})

	it('asks once more when a reply is not the JSON asked for', async () => {
		const opencode = fakeOpencode({ prose: 1 })
		const result = await suggestGroups(pile(6), { opencode: opencode.ask, lm: null })
		expect(result.engine).toBe('opencode')
		expect(result.suggestions.map((s) => s.name).sort()).toEqual(['Rust', 'Taxes'])
		expect(opencode.prompts).toHaveLength(2)
		expect(opencode.prompts[1].endsWith(RETRY_NOTE)).toBe(true)
	})

	it("drops a reason's closing full stop, since the panel adds its own", async () => {
		const failing = fakeOpencode({ fail: 'Free usage limit reached. Try again in 72 min.' })
		const result = await suggestGroups(pile(6), { opencode: failing.ask, lm: null })
		expect(result.fallbackReason).toBe(
			'opencode: Free usage limit reached. Try again in 72 min',
		)
	})

	it('falls back, saying why, when the second reply is not the JSON either', async () => {
		const opencode = fakeOpencode({ prose: 2 })
		const result = await suggestGroups(pile(6), { opencode: opencode.ask, lm: null })
		expect(result).toMatchObject({
			engine: 'site',
			fallbackReason: "opencode: its reply wasn't the JSON asked for",
		})
	})

	it('falls back to the on-device model, then by site, saying why', async () => {
		const failing = fakeOpencode({ fail: 'pairing expired' })
		const onDevice = await suggestGroups(pile(6), { opencode: failing.ask, lm: fakeModel().lm })
		expect(onDevice).toMatchObject({
			engine: 'on-device',
			fallbackReason: 'opencode: pairing expired',
		})
		const bySite = await suggestGroups(pile(6), { opencode: failing.ask, lm: null })
		expect(bySite).toMatchObject({
			engine: 'site',
			fallbackReason: 'opencode: pairing expired',
		})
	})

	it('is skipped when another engine is asked for', async () => {
		const opencode = fakeOpencode()
		expect(
			(await suggestGroups(pile(6), { opencode: opencode.ask, engine: 'site' })).engine,
		).toBe('site')
		const onDevice = await suggestGroups(pile(6), {
			opencode: opencode.ask,
			engine: 'on-device',
			lm: fakeModel().lm,
		})
		expect(onDevice.engine).toBe('on-device')
		expect(opencode.prompts).toEqual([])
	})
})
