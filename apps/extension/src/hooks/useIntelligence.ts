/**
 * useIntelligence — semantic search over saved tabs via the PartyKit server's
 * embeddings endpoint. Smart grouping lives in lib/smartGroup.
 */
import { getAuthState } from '@/sync/auth'

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

interface SearchInput {
	stableId: string
	title: string
	url: string
}

export function useIntelligence() {
	/**
	 * Semantic ranking of saved tabs against a query via the server's embeddings
	 * endpoint. Returns ordered stableIds, or null if unavailable (caller should
	 * then fall back to local substring search).
	 */
	async function semanticSearch(query: string, tabs: SearchInput[]): Promise<string[] | null> {
		const auth = await getAuthState()
		if (!auth?.token || !auth.user?.id || !query.trim() || tabs.length === 0) return null
		const proto = PARTYKIT_HOST.includes('localhost') ? 'http' : 'https'
		const url = `${proto}://${PARTYKIT_HOST}/parties/main/${auth.user.id}/search`
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${auth.token}`,
				},
				body: JSON.stringify({ query, tabs }),
			})
			if (!res.ok) return null
			const data = (await res.json()) as { results?: { stableId: string; score: number }[] }
			return (data.results ?? []).map((r) => r.stableId)
		} catch {
			return null
		}
	}

	return { semanticSearch }
}
