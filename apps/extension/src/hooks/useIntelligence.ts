/**
 * useIntelligence — LLM-assisted grouping.
 *
 * Sends tab titles+URLs to the PartyKit `/cluster` endpoint (Cloudflare Workers
 * AI). If that's unreachable or the backend isn't deployed yet, it falls back to
 * local domain-based grouping so the "Auto-group" UX still works offline.
 */
import { ref } from 'vue'
import { getAuthState } from '@/sync/auth'
import type { SaveableTab } from '@/types'

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

interface ClusterInput {
	stableId: string
	title: string
	url: string
}
interface Cluster {
	name: string
	tabIds: string[]
}

export interface SuggestedGroup {
	name: string
	tabs: SaveableTab[]
}

export function useIntelligence() {
	const isSuggesting = ref(false)
	const suggestions = ref<SuggestedGroup[]>([])
	const usedFallback = ref(false)

	async function suggest(tabs: SaveableTab[]): Promise<void> {
		if (tabs.length === 0) return
		isSuggesting.value = true
		usedFallback.value = false
		try {
			const byId = new Map(tabs.map((t) => [t.stableId, t]))
			const input: ClusterInput[] = tabs.map((t) => ({
				stableId: t.stableId,
				title: t.title || '',
				url: t.url || '',
			}))

			let clusters = await fetchClusters(input)
			if (!clusters) {
				clusters = clusterByDomainLocal(input)
				usedFallback.value = true
			}

			suggestions.value = clusters
				.map((c) => ({
					name: c.name,
					tabs: c.tabIds
						.map((id) => byId.get(id))
						.filter((t): t is SaveableTab => t != null),
				}))
				.filter((g) => g.tabs.length > 0)
		} finally {
			isSuggesting.value = false
		}
	}

	function dismiss(): void {
		suggestions.value = []
	}

	function removeSuggestion(index: number): void {
		suggestions.value.splice(index, 1)
	}

	/**
	 * Semantic ranking of saved tabs against a query via the server's embeddings
	 * endpoint. Returns ordered stableIds, or null if unavailable (caller should
	 * then fall back to local substring search).
	 */
	async function semanticSearch(
		query: string,
		tabs: ClusterInput[],
	): Promise<string[] | null> {
		const auth = await getAuthState()
		if (!auth?.token || !auth.user?.id || !query.trim() || tabs.length === 0) return null
		const proto = PARTYKIT_HOST.includes('localhost') ? 'http' : 'https'
		const url = `${proto}://${PARTYKIT_HOST}/parties/main/${auth.user.id}/search`
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
				body: JSON.stringify({ query, tabs }),
			})
			if (!res.ok) return null
			const data = (await res.json()) as { results?: { stableId: string; score: number }[] }
			return (data.results ?? []).map((r) => r.stableId)
		} catch {
			return null
		}
	}

	return {
		isSuggesting,
		suggestions,
		usedFallback,
		suggest,
		dismiss,
		removeSuggestion,
		semanticSearch,
	}
}

async function fetchClusters(input: ClusterInput[]): Promise<Cluster[] | null> {
	const auth = await getAuthState()
	if (!auth?.token || !auth.user?.id) return null // not signed in → local fallback

	const proto = PARTYKIT_HOST.includes('localhost') ? 'http' : 'https'
	const url = `${proto}://${PARTYKIT_HOST}/parties/main/${auth.user.id}/cluster`

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
			body: JSON.stringify({ tabs: input }),
		})
		if (!res.ok) return null
		const data = (await res.json()) as { clusters?: Cluster[] }
		return data.clusters ?? null
	} catch {
		return null
	}
}

function clusterByDomainLocal(input: ClusterInput[]): Cluster[] {
	const groups = new Map<string, string[]>()
	for (const t of input) {
		let host = 'other'
		try {
			host = new URL(t.url).hostname.replace(/^www\./, '')
		} catch {
			/* keep 'other' */
		}
		const arr = groups.get(host) ?? []
		arr.push(t.stableId)
		groups.set(host, arr)
	}
	return [...groups.entries()].map(([name, tabIds]) => ({ name, tabIds }))
}
