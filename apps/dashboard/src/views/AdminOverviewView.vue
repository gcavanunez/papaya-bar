<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { getAdminStats, type AdminStats } from '@/api'
import AppHeader from '@/components/AppHeader.vue'

const { token } = useAuth()

const stats = ref<AdminStats | null>(null)
const loading = ref(true)
let interval: ReturnType<typeof setInterval> | null = null

async function loadStats() {
	if (!token.value) return
	try {
		stats.value = await getAdminStats(token.value)
	} catch {
		// ignore
	} finally {
		loading.value = false
	}
}

onMounted(() => {
	loadStats()
	interval = setInterval(loadStats, 30_000)
})

onUnmounted(() => {
	if (interval) clearInterval(interval)
})
</script>

<template>
	<div class="min-h-screen bg-gray-950">
		<AppHeader />

		<main class="mx-auto max-w-4xl px-6 py-8">
			<h2 class="mb-6 text-xl font-semibold">Admin Overview</h2>

			<div v-if="loading" class="text-sm text-gray-400">Loading stats...</div>

			<div v-else-if="stats" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
					<p class="text-xs text-gray-500 uppercase">Total Users</p>
					<p class="mt-2 text-3xl font-bold text-[#fb923c]">{{ stats.totalUsers }}</p>
				</div>

				<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
					<p class="text-xs text-gray-500 uppercase">Active Sessions</p>
					<p class="mt-2 text-3xl font-bold text-[#fb923c]">
						{{ stats.totalActiveSessions }}
					</p>
				</div>

				<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
					<p class="text-xs text-gray-500 uppercase">Active in 24h</p>
					<p class="mt-2 text-3xl font-bold text-[#fb923c]">
						{{ stats.activeUsersLast24h }}
					</p>
				</div>
			</div>
		</main>
	</div>
</template>
