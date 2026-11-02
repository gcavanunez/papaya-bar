<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { getAdminActivity, type ActivityEvent } from '@/api'
import AppHeader from '@/components/AppHeader.vue'

const { token } = useAuth()

const events = ref<ActivityEvent[]>([])
const loading = ref(true)

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

const dotColor: Record<string, string> = {
	register: 'bg-blue-400',
	login: 'bg-green-400',
	login_failed: 'bg-red-400',
	logout: 'bg-amber-400',
	logout_all: 'bg-amber-400',
	verify: 'bg-gray-400',
}

const eventLabel: Record<string, string> = {
	register: 'Registered',
	login: 'Logged in',
	login_failed: 'Login failed',
	logout: 'Logged out',
	logout_all: 'Logged out all',
	verify: 'Verified',
}

async function loadActivity() {
	if (!token.value) return
	loading.value = true
	try {
		events.value = await getAdminActivity(token.value)
	} catch {
		// ignore
	} finally {
		loading.value = false
	}
}

onMounted(loadActivity)
</script>

<template>
	<div class="min-h-screen bg-gray-950">
		<AppHeader />

		<main class="mx-auto max-w-4xl px-6 py-8">
			<h2 class="mb-6 text-xl font-semibold">Activity Log</h2>

			<div v-if="loading" class="text-sm text-gray-400">Loading activity...</div>

			<div v-else class="rounded-xl border border-gray-800 bg-gray-900">
				<div class="max-h-[calc(100vh-14rem)] overflow-y-auto">
					<div
						v-for="(event, i) in events"
						:key="i"
						class="flex items-center gap-4 border-b border-gray-800/50 px-5 py-3.5 last:border-0"
					>
						<span
							class="h-2.5 w-2.5 shrink-0 rounded-full"
							:class="dotColor[event.type] || 'bg-gray-400'"
						></span>

						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm">{{ event.email }}</span>
								<span class="shrink-0 text-xs text-gray-500">
									{{ eventLabel[event.type] || event.type }}
								</span>
							</div>
							<p v-if="event.deviceName" class="mt-0.5 text-xs text-gray-600">
								{{ event.deviceName }}
							</p>
						</div>

						<span class="shrink-0 text-xs text-gray-500">
							{{ timeAgo(event.timestamp) }}
						</span>
					</div>
				</div>

				<p v-if="events.length === 0" class="px-5 py-6 text-center text-sm text-gray-500">
					No activity recorded.
				</p>
			</div>
		</main>
	</div>
</template>
