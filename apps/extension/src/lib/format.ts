import { differenceInCalendarDays, format, isSameYear } from 'date-fns'

export function getHostname(url?: string): string {
	if (!url) return ''
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

/** Hostname plus path, without protocol, query or trailing slash. */
export function getDisplayUrl(url?: string): string {
	if (!url) return ''
	try {
		const parsed = new URL(url)
		const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
		return `${parsed.hostname.replace(/^www\./, '')}${path}`
	} catch {
		return url
	}
}

/** Pages that belong to this extension (the manager itself, the side panel, …). */
export function isOwnExtensionUrl(url?: string): boolean {
	if (!url || typeof chrome === 'undefined' || !chrome.runtime?.id) return false
	return url.startsWith(`chrome-extension://${chrome.runtime.id}/`)
}

export type RecencyBucket = { key: string; label: string; order: number }

/** Coarse buckets for grouping things by how recently they happened. */
export function recencyBucket(date: Date, now = new Date()): RecencyBucket {
	const days = differenceInCalendarDays(now, date)
	if (days <= 0) return { key: 'today', label: 'Today', order: 0 }
	if (days === 1) return { key: 'yesterday', label: 'Yesterday', order: 1 }
	if (days < 7) return { key: 'week', label: 'Earlier this week', order: 2 }
	if (days < 30) return { key: 'month', label: 'Last 30 days', order: 3 }
	return { key: 'older', label: 'Older', order: 4 }
}

/** Per-day label: "Today", "Yesterday", "Monday, Sep 27" or "Sep 27, 2025". */
export function dayLabel(date: Date, now = new Date()): string {
	const days = differenceInCalendarDays(now, date)
	if (days <= 0) return 'Today'
	if (days === 1) return 'Yesterday'
	return isSameYear(date, now) ? format(date, 'EEEE, MMM d') : format(date, 'MMM d, yyyy')
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`
}
