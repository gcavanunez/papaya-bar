<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useSyncSocket } from '@/composables/useSyncSocket'
import { getSyncedData, assembleSessions, type SyncedSession, type SyncStoreData } from '@/api'
import AppHeader from '@/components/AppHeader.vue'

const { token, user } = useAuth()

const rawData = ref<SyncStoreData | null>(null)
const loading = ref(true)
const error = ref('')
const expandedSession = ref<string | null>(null)
const liveConnected = ref(false)

const sessions = computed(() => {
	if (!rawData.value) return []
	return assembleSessions(rawData.value)
})

const lastSyncedAt = computed(() => {
	if (!rawData.value?.updatedAt) return null
	return new Date(rawData.value.updatedAt)
})

async function loadData(showLoading = true) {
	if (!token.value || !user.value) return
	if (showLoading) loading.value = true
	error.value = ''
	try {
		rawData.value = await getSyncedData(token.value, user.value.id)
	} catch (e: unknown) {
		error.value = e instanceof Error ? e.message : 'Failed to load data'
	} finally {
		loading.value = false
	}
}

// Real-time: connect to sync room WebSocket, re-fetch on updates
if (token.value && user.value) {
	const { connected } = useSyncSocket(token.value, user.value.id, () => {
		loadData(false)
	})
	watch(connected, (v) => {
		liveConnected.value = v
	})
}

function toggleSession(id: string) {
	expandedSession.value = expandedSession.value === id ? null : id
}

function timeAgo(ts: number): string {
	const diff = Date.now() - ts
	const secs = Math.floor(diff / 1000)
	if (secs < 60) return 'just now'
	const mins = Math.floor(secs / 60)
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	const days = Math.floor(hrs / 24)
	if (days < 30) return `${days}d ago`
	return new Date(ts).toLocaleDateString()
}

function faviconUrl(url: string): string {
	try {
		const hostname = new URL(url).hostname
		return `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`
	} catch {
		return ''
	}
}

function tabCountLabel(session: SyncedSession): string {
	const n = session.tabs.length
	return `${n} tab${n === 1 ? '' : 's'}`
}

function groupCountLabel(session: SyncedSession): string {
	const n = session.groups.length
	if (n === 0) return ''
	return `${n} group${n === 1 ? '' : 's'}`
}

onMounted(loadData)
</script>

<template>
	<div class="min-h-screen bg-gray-950">
		<AppHeader />

		<main class="mx-auto max-w-5xl px-6 py-8">
			<div class="mb-6 flex items-center justify-between">
				<div>
					<h2 class="text-xl font-semibold">My Sessions</h2>
					<div class="mt-1 flex items-center gap-3 text-sm text-gray-500">
						<p v-if="lastSyncedAt">Last synced {{ timeAgo(lastSyncedAt.getTime()) }}</p>
						<span
							v-if="liveConnected"
							class="flex items-center gap-1.5 text-xs text-green-400"
						>
							<span
								class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400"
							></span>
							Live
						</span>
					</div>
				</div>
				<button
					@click="loadData()"
					class="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
				>
					Refresh
				</button>
			</div>

			<!-- Loading -->
			<div v-if="loading" class="text-sm text-gray-400">Loading synced data...</div>

			<!-- Error -->
			<div
				v-else-if="error"
				class="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-400"
			>
				{{ error }}
			</div>

			<!-- No data -->
			<div
				v-else-if="sessions.length === 0"
				class="rounded-xl border border-gray-800 bg-gray-900 px-5 py-12 text-center"
			>
				<p class="text-gray-400">No synced sessions yet.</p>
				<p class="mt-2 text-sm text-gray-600">
					Save a session in the extension while signed in to see it here.
				</p>
			</div>

			<!-- Sessions list -->
			<div v-else class="space-y-3">
				<div
					v-for="session in sessions"
					:key="session.id"
					class="rounded-xl border border-gray-800 bg-gray-900 transition-colors"
				>
					<!-- Session header -->
					<button
						@click="toggleSession(session.id)"
						class="flex w-full items-center justify-between px-5 py-4 text-left"
					>
						<div class="min-w-0 flex-1">
							<h3 class="truncate font-medium">
								{{ session.title || 'Untitled Session' }}
							</h3>
							<p
								v-if="session.description"
								class="mt-0.5 truncate text-sm text-gray-500"
							>
								{{ session.description }}
							</p>
							<div class="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
								<span>{{ tabCountLabel(session) }}</span>
								<span v-if="groupCountLabel(session)">{{
									groupCountLabel(session)
								}}</span>
								<span>{{ timeAgo(session.updatedAt) }}</span>
							</div>
						</div>
						<svg
							class="ml-4 h-5 w-5 shrink-0 text-gray-500 transition-transform"
							:class="{ 'rotate-180': expandedSession === session.id }"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="m19.5 8.25-7.5 7.5-7.5-7.5"
							/>
						</svg>
					</button>

					<!-- Expanded: tab list -->
					<div
						v-if="expandedSession === session.id"
						class="border-t border-gray-800 px-5 py-3"
					>
						<!-- Groups -->
						<div v-if="session.groups.length" class="mb-3 flex flex-wrap gap-2">
							<span
								v-for="group in session.groups"
								:key="group.originalId"
								class="rounded-full px-2.5 py-0.5 text-xs font-medium"
								:style="{
									backgroundColor: `color-mix(in srgb, ${group.color} 20%, transparent)`,
									color: group.color,
								}"
							>
								{{ group.title || group.color }}
							</span>
						</div>

						<!-- Tabs -->
						<ul class="max-h-96 space-y-0.5 overflow-y-auto">
							<li
								v-for="tab in session.tabs"
								:key="tab.stableId"
								class="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-800/50"
							>
								<img
									v-if="tab.favIconUrl || tab.url"
									:src="tab.favIconUrl || faviconUrl(tab.url)"
									class="h-4 w-4 shrink-0"
									@error="
										($event.target as HTMLImageElement).style.display = 'none'
									"
								/>
								<span v-else class="h-4 w-4 shrink-0 rounded-sm bg-gray-700"></span>

								<a
									:href="tab.url"
									target="_blank"
									rel="noopener noreferrer"
									class="min-w-0 flex-1 truncate text-sm text-gray-300 transition-colors hover:text-[#fb923c]"
									:title="tab.url"
								>
									{{ tab.title || tab.url }}
								</a>
							</li>
						</ul>

						<p
							v-if="session.tabs.length === 0"
							class="py-3 text-center text-sm text-gray-600"
						>
							No tabs in this session.
						</p>
					</div>
				</div>
			</div>
		</main>
	</div>
</template>
