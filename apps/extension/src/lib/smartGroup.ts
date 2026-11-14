/**
 * smartGroup — suggest groups for loose tabs.
 *
 * Every engine returns the same thing: groups of tab ids with a name. "By site" always
 * works. "On-device" asks Chrome's built-in model (the Prompt API) to group by topic,
 * with replies forced to a JSON schema. "opencode" asks the model your opencode server
 * uses. Model replies are always checked against the real tabs. The Prompt API isn't
 * available in workers, so the on-device engine only runs on extension pages.
 */

export interface GroupableTab {
	id: number
	title?: string
	url?: string
}

export interface Suggestion {
	name: string
	tabIds: number[]
}

export type Engine = 'site' | 'on-device' | 'opencode'

/** Send one prompt to a model and return its text reply */
export type Ask = (prompt: string, signal?: AbortSignal) => Promise<string>
export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable'

export interface SuggestResult {
	engine: Engine
	suggestions: Suggestion[]
	/** Why the on-device engine was skipped after being tried */
	fallbackReason?: string
}

/** A group needs at least this many tabs; the rest stay loose. */
export const MIN_GROUP_SIZE = 2
const MAX_NAME_LENGTH = 32
const BATCH_SIZE = 30
/** Hosted models read far more at once than the on-device one */
const OPENCODE_BATCH_SIZE = 150
const MAX_TITLE_LENGTH = 90
const MAX_KNOWN_NAMES = 40

const BLANK_PAGES = new Set([
	'about:blank',
	'chrome://newtab/',
	'chrome://new-tab-page/',
	'edge://newtab/',
])

/** New tab and blank pages have nothing to group by. */
export function isBlankPage(url: string | undefined): boolean {
	return !url || BLANK_PAGES.has(url)
}

// ==================== By site ====================

/** A short label for the site a URL belongs to, or null when it has none. */
export function siteLabel(url: string | undefined): string | null {
	if (!url) return null
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}
	if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
		return parsed.hostname.replace(/^www\./, '') || null
	}
	if (parsed.protocol === 'chrome:' || parsed.protocol === 'about:') return 'Browser pages'
	if (parsed.protocol === 'file:') return 'Files'
	return null
}

export function groupBySite(tabs: GroupableTab[]): Suggestion[] {
	const bySite = new Map<string, number[]>()
	for (const tab of tabs) {
		const site = siteLabel(tab.url)
		if (!site) continue
		const ids = bySite.get(site) ?? []
		ids.push(tab.id)
		bySite.set(site, ids)
	}
	return mergeSuggestions([...bySite].map(([name, tabIds]) => ({ name, tabIds })))
}

// ==================== Shared post-processing ====================

/**
 * Merge groups with the same name (ignoring case), give each tab to the first group
 * that claims it, drop groups below the minimum size, and put the biggest first.
 */
export function mergeSuggestions(
	suggestions: Suggestion[],
	minSize = MIN_GROUP_SIZE,
): Suggestion[] {
	const byName = new Map<string, Suggestion>()
	const claimed = new Set<number>()
	for (const suggestion of suggestions) {
		const key = suggestion.name.toLowerCase()
		const entry = byName.get(key) ?? { name: suggestion.name, tabIds: [] }
		for (const id of suggestion.tabIds) {
			if (claimed.has(id)) continue
			claimed.add(id)
			entry.tabIds.push(id)
		}
		byName.set(key, entry)
	}
	return [...byName.values()]
		.filter((suggestion) => suggestion.tabIds.length >= minSize)
		.sort((a, b) => b.tabIds.length - a.tabIds.length)
}

// ==================== On-device (Chrome Prompt API) ====================

interface LanguageModelSession {
	prompt(
		input: string,
		options?: { responseConstraint?: object; signal?: AbortSignal },
	): Promise<string>
	clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>
	destroy(): void
}

export interface LanguageModelApi {
	availability(options?: object): Promise<OnDeviceStatus>
	create(options?: {
		initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[]
		signal?: AbortSignal
		monitor?: (monitor: EventTarget) => void
	}): Promise<LanguageModelSession>
}

function languageModel(): LanguageModelApi | null {
	return (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel ?? null
}

// availability() must get the same options as create() and prompt()
const MODEL_OPTIONS = {
	expectedInputs: [{ type: 'text', languages: ['en'] }],
	expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

const SYSTEM_PROMPT = `You sort a person's open browser tabs into groups, the way they would label Chrome tab groups.
Rules:
- Group by topic, project or task, not just by website.
- Names are 1 to 3 words, like "Trip to Lisbon", "Rust", "Taxes", "Hiring".
- Each tab number goes in at most one group. Leave out tabs that fit no group.
- Prefer fewer, broader groups. A group needs at least 2 tabs.
Reply only with JSON.`

export const RESPONSE_SCHEMA = {
	type: 'object',
	properties: {
		groups: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					tabs: { type: 'array', items: { type: 'integer' } },
				},
				required: ['name', 'tabs'],
				additionalProperties: false,
			},
		},
	},
	required: ['groups'],
	additionalProperties: false,
}

export async function onDeviceStatus(lm = languageModel()): Promise<OnDeviceStatus> {
	if (!lm) return 'unavailable'
	try {
		return await lm.availability(MODEL_OPTIONS)
	} catch {
		return 'unavailable'
	}
}

/** Download Chrome's on-device model. Needs a user gesture (a click) to start. */
export async function downloadOnDeviceModel(
	onProgress: (fraction: number) => void,
	lm = languageModel(),
): Promise<void> {
	if (!lm) throw new Error('This browser has no on-device model')
	const session = await lm.create({
		...MODEL_OPTIONS,
		monitor(monitor) {
			monitor.addEventListener('downloadprogress', (event) => {
				onProgress((event as ProgressEvent).loaded)
			})
		},
	})
	session.destroy()
}

/** The prompt for one batch. Tabs are numbered from 1 so the model never sees Chrome's ids. */
export function buildPrompt(batch: GroupableTab[], knownNames: string[]): string {
	const lines = batch.map((tab, i) => {
		const title = (tab.title || tab.url || '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, MAX_TITLE_LENGTH)
		const site = siteLabel(tab.url)
		return `${i + 1}. ${title}${site ? ` (${site})` : ''}`
	})
	const reuse = knownNames.length
		? `\n\nGroups so far. Reuse a name when a tab fits it: ${knownNames.join(', ')}`
		: ''
	return `Tabs:\n${lines.join('\n')}${reuse}`
}

function cleanName(value: unknown): string {
	if (typeof value !== 'string') return ''
	return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim()
}

/** The JSON object in a reply, even if a model wrapped it in prose or a code fence */
function extractJson(reply: string): unknown {
	try {
		return JSON.parse(reply)
	} catch {
		const start = reply.indexOf('{')
		const end = reply.lastIndexOf('}')
		if (start === -1 || end <= start) return null
		try {
			return JSON.parse(reply.slice(start, end + 1))
		} catch {
			return null
		}
	}
}

/** Map one batch's reply back to tab ids. Unknown numbers, repeats and nameless groups are dropped. */
export function parseReply(reply: string, batchIds: number[]): Suggestion[] {
	const data = extractJson(reply)
	const groups = (data as { groups?: unknown } | null)?.groups
	if (!Array.isArray(groups)) return []

	const used = new Set<number>()
	const suggestions: Suggestion[] = []
	for (const group of groups) {
		const name = cleanName((group as { name?: unknown } | null)?.name)
		const numbers = (group as { tabs?: unknown } | null)?.tabs
		if (!name || !Array.isArray(numbers)) continue
		const tabIds: number[] = []
		for (const n of numbers) {
			if (!Number.isInteger(n) || n < 1 || n > batchIds.length) continue
			const id = batchIds[n - 1]
			if (used.has(id)) continue
			used.add(id)
			tabIds.push(id)
		}
		if (tabIds.length) suggestions.push({ name, tabIds })
	}
	return suggestions
}

function isQuotaError(error: unknown): boolean {
	return (error as { name?: string } | null)?.name === 'QuotaExceededError'
}

function knownNames(found: Suggestion[]): string[] {
	return [...new Set(found.map((s) => s.name))].slice(0, MAX_KNOWN_NAMES)
}

/**
 * Group tabs with a model, in batches; names found so far are passed along so batches
 * agree. A batch too big for the model's context window is split in half and retried.
 */
export async function groupWithModel(
	tabs: GroupableTab[],
	ask: Ask,
	options: {
		signal?: AbortSignal
		onProgress?: (done: number, total: number) => void
		batchSize: number
		/** Text put before each batch's tab list */
		preamble?: string
	},
): Promise<Suggestion[]> {
	const { signal, batchSize } = options
	const found: Suggestion[] = []
	const queue: GroupableTab[][] = []
	for (let i = 0; i < tabs.length; i += batchSize) queue.push(tabs.slice(i, i + batchSize))
	let done = 0
	while (queue.length) {
		const batch = queue.shift()!
		try {
			const prompt = `${options.preamble ?? ''}${buildPrompt(batch, knownNames(found))}`
			const reply = await ask(prompt, signal)
			found.push(
				...parseReply(
					reply,
					batch.map((tab) => tab.id),
				),
			)
			done += batch.length
			options.onProgress?.(done, tabs.length)
		} catch (error) {
			if (!isQuotaError(error) || batch.length < 2) throw error
			const half = Math.ceil(batch.length / 2)
			queue.unshift(batch.slice(0, half), batch.slice(half))
		}
	}
	return mergeSuggestions(found)
}

/** Group tabs with Chrome's on-device model; each batch runs in a fresh copy of the session */
export async function groupOnDevice(
	tabs: GroupableTab[],
	options: {
		signal?: AbortSignal
		onProgress?: (done: number, total: number) => void
		batchSize?: number
		lm?: LanguageModelApi | null
	} = {},
): Promise<Suggestion[]> {
	const lm = options.lm === undefined ? languageModel() : options.lm
	if (!lm) throw new Error('This browser has no on-device model')
	const { signal } = options
	const base = await lm.create({
		...MODEL_OPTIONS,
		initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
		signal,
	})
	try {
		return await groupWithModel(
			tabs,
			async (prompt) => {
				const session = await base.clone({ signal })
				try {
					return await session.prompt(prompt, {
						responseConstraint: RESPONSE_SCHEMA,
						signal,
					})
				} finally {
					session.destroy()
				}
			},
			{ ...options, batchSize: options.batchSize ?? BATCH_SIZE },
		)
	} finally {
		base.destroy()
	}
}

/** The instructions sent with every opencode batch (it has no system prompt or schema option) */
export const OPENCODE_PREAMBLE = `${SYSTEM_PROMPT}
The reply must be one JSON object and nothing else: {"groups":[{"name":"...","tabs":[1,2]}]}

`

/** Group tabs with the model your opencode server uses */
export function groupWithOpencode(
	tabs: GroupableTab[],
	ask: Ask,
	options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Suggestion[]> {
	return groupWithModel(tabs, ask, {
		...options,
		batchSize: OPENCODE_BATCH_SIZE,
		preamble: OPENCODE_PREAMBLE,
	})
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Pick an engine and group. "auto" escalates: opencode when it's connected, else the
 * on-device model when it's ready, else by site. If a model fails, the next engine
 * down is used and the reply says why. Blank and new tab pages are left out.
 */
export async function suggestGroups(
	allTabs: GroupableTab[],
	options: {
		engine?: Engine | 'auto'
		signal?: AbortSignal
		onProgress?: (done: number, total: number) => void
		lm?: LanguageModelApi | null
		/** How to reach opencode, when it's connected and turned on */
		opencode?: Ask | null
	} = {},
): Promise<SuggestResult> {
	const tabs = allTabs.filter((tab) => !isBlankPage(tab.url))
	const lm = options.lm === undefined ? languageModel() : options.lm
	const wanted = options.engine ?? 'auto'
	const reasons: string[] = []
	const enough = tabs.length >= MIN_GROUP_SIZE

	if (enough && options.opencode && (wanted === 'auto' || wanted === 'opencode')) {
		try {
			return {
				engine: 'opencode',
				suggestions: await groupWithOpencode(tabs, options.opencode, options),
			}
		} catch (error) {
			if (options.signal?.aborted) throw error
			reasons.push(`opencode: ${message(error)}`)
		}
	}
	if (enough && wanted !== 'site' && (await onDeviceStatus(lm)) === 'available') {
		try {
			return {
				engine: 'on-device',
				suggestions: await groupOnDevice(tabs, { ...options, lm }),
				...(reasons.length ? { fallbackReason: reasons.join('; ') } : {}),
			}
		} catch (error) {
			if (options.signal?.aborted) throw error
			reasons.push(`on-device model: ${message(error)}`)
		}
	}
	return {
		engine: 'site',
		suggestions: groupBySite(tabs),
		...(reasons.length ? { fallbackReason: reasons.join('; ') } : {}),
	}
}
