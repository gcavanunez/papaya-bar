<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { listSessions, revokeSession, type SessionInfo } from '@/api'
import AppHeader from '@/components/AppHeader.vue'

const { user, token } = useAuth()

const sessions = ref<SessionInfo[]>([])
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

async function loadSessions() {
	if (!token.value) return
	loading.value = true
	try {
		sessions.value = await listSessions(token.value)
	} catch {
		// ignore
	} finally {
		loading.value = false
	}
}

async function handleRevoke(sessionId: string) {
	if (!token.value) return
	await revokeSession(token.value, sessionId)
	await loadSessions()
}

onMounted(loadSessions)
</script>

<template>
	<div class="min-h-screen bg-gray-950">
		<AppHeader />

		<main class="mx-auto max-w-4xl px-6 py-8">
			<h2 class="mb-6 text-xl font-semibold">My Account</h2>

			<div class="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-5">
				<div class="grid grid-cols-3 gap-6">
					<div>
						<p class="text-xs text-gray-500 uppercase">Email</p>
						<p class="mt-1 text-sm">{{ user?.email }}</p>
					</div>
					<div>
						<p class="text-xs text-gray-500 uppercase">Role</p>
						<p class="mt-1 text-sm capitalize">{{ user?.role }}</p>
					</div>
					<div>
						<p class="text-xs text-gray-500 uppercase">Active Sessions</p>
						<p class="mt-1 text-sm">{{ sessions.length }}</p>
					</div>
				</div>
			</div>

			<h3 class="mb-4 text-lg font-medium">Sessions</h3>

			<div v-if="loading" class="text-sm text-gray-400">Loading sessions...</div>

			<div v-else class="space-y-3">
				<div
					v-for="session in sessions"
					:key="session.id"
					class="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-5"
				>
					<div>
						<div class="flex items-center gap-2">
							<p class="text-sm font-medium">{{ session.deviceName }}</p>
							<span
								v-if="session.isCurrent"
								class="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400"
							>
								Current
							</span>
						</div>
						<p class="mt-1 text-xs text-gray-500">
							Last active {{ timeAgo(session.lastActiveAt) }}
						</p>
					</div>
					<button
						v-if="!session.isCurrent"
						@click="handleRevoke(session.id)"
						class="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
					>
						Revoke
					</button>
				</div>

				<p v-if="sessions.length === 0" class="text-sm text-gray-500">
					No active sessions.
				</p>
			</div>
		</main>
	</div>
</template>
