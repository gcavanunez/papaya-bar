<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { getAdminUsers, getAdminUserSessions, type AdminUser, type UserDetail } from '@/api'
import AppHeader from '@/components/AppHeader.vue'

const { token } = useAuth()

const users = ref<AdminUser[]>([])
const loading = ref(true)
const selectedUserId = ref<string | null>(null)
const userDetail = ref<UserDetail | null>(null)
const detailLoading = ref(false)

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

async function loadUsers() {
	if (!token.value) return
	loading.value = true
	try {
		users.value = await getAdminUsers(token.value)
	} catch {
		// ignore
	} finally {
		loading.value = false
	}
}

async function viewUser(userId: string) {
	if (!token.value) return
	if (selectedUserId.value === userId) {
		selectedUserId.value = null
		userDetail.value = null
		return
	}
	selectedUserId.value = userId
	detailLoading.value = true
	try {
		userDetail.value = await getAdminUserSessions(token.value, userId)
	} catch {
		userDetail.value = null
	} finally {
		detailLoading.value = false
	}
}

onMounted(loadUsers)
</script>

<template>
	<div class="min-h-screen bg-gray-950">
		<AppHeader />

		<main class="mx-auto max-w-5xl px-6 py-8">
			<h2 class="mb-6 text-xl font-semibold">Users</h2>

			<div v-if="loading" class="text-sm text-gray-400">Loading users...</div>

			<div v-else class="rounded-xl border border-gray-800 bg-gray-900">
				<table class="w-full text-sm">
					<thead>
						<tr
							class="border-b border-gray-800 text-left text-xs text-gray-500 uppercase"
						>
							<th class="px-5 py-3 font-medium">Email</th>
							<th class="px-5 py-3 font-medium">Role</th>
							<th class="px-5 py-3 font-medium">Sessions</th>
							<th class="px-5 py-3 font-medium">Last Active</th>
							<th class="px-5 py-3 font-medium"></th>
						</tr>
					</thead>
					<tbody>
						<template v-for="u in users" :key="u.id">
							<tr
								class="border-b border-gray-800/50 transition-colors hover:bg-gray-800/30"
							>
								<td class="px-5 py-3">{{ u.email }}</td>
								<td class="px-5 py-3">
									<span
										class="rounded-full px-2.5 py-0.5 text-xs font-medium"
										:class="
											u.role === 'admin'
												? 'bg-[#fb923c]/15 text-[#fb923c]'
												: 'bg-gray-700 text-gray-300'
										"
									>
										{{ u.role }}
									</span>
								</td>
								<td class="px-5 py-3 text-gray-400">{{ u.sessionCount }}</td>
								<td class="px-5 py-3 text-gray-400">
									{{ u.lastActiveAt ? timeAgo(u.lastActiveAt) : 'Never' }}
								</td>
								<td class="px-5 py-3 text-right">
									<button
										@click="viewUser(u.id)"
										class="rounded-lg border px-3 py-1 text-xs transition-colors"
										:class="
											selectedUserId === u.id
												? 'border-[#fb923c]/50 text-[#fb923c]'
												: 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
										"
									>
										{{ selectedUserId === u.id ? 'Close' : 'View' }}
									</button>
								</td>
							</tr>

							<!-- Detail panel -->
							<tr v-if="selectedUserId === u.id">
								<td
									colspan="5"
									class="border-b border-gray-800/50 bg-gray-800/20 px-5 py-4"
								>
									<div v-if="detailLoading" class="text-sm text-gray-400">
										Loading details...
									</div>
									<div v-else-if="userDetail">
										<div class="mb-4 grid grid-cols-3 gap-4">
											<div>
												<p class="text-xs text-gray-500 uppercase">Email</p>
												<p class="mt-1 text-sm">
													{{ userDetail.user?.email }}
												</p>
											</div>
											<div>
												<p class="text-xs text-gray-500 uppercase">Role</p>
												<p class="mt-1 text-sm capitalize">
													{{ userDetail.user?.role }}
												</p>
											</div>
											<div>
												<p class="text-xs text-gray-500 uppercase">
													Created
												</p>
												<p class="mt-1 text-sm">
													{{
														userDetail.user
															? new Date(
																	userDetail.user.createdAt,
																).toLocaleDateString()
															: '-'
													}}
												</p>
											</div>
										</div>

										<p class="mb-2 text-xs text-gray-500 uppercase">
											Sessions ({{ userDetail.sessions.length }})
										</p>
										<div v-if="userDetail.sessions.length" class="space-y-2">
											<div
												v-for="s in userDetail.sessions"
												:key="s.id"
												class="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm"
											>
												<div>
													<p class="font-medium">{{ s.deviceName }}</p>
													<p class="mt-0.5 text-xs text-gray-500">
														Last active {{ timeAgo(s.lastActiveAt) }}
													</p>
												</div>
											</div>
										</div>
										<p v-else class="text-sm text-gray-500">
											No active sessions.
										</p>
									</div>
								</td>
							</tr>
						</template>
					</tbody>
				</table>

				<p v-if="users.length === 0" class="px-5 py-6 text-center text-sm text-gray-500">
					No users found.
				</p>
			</div>
		</main>
	</div>
</template>
