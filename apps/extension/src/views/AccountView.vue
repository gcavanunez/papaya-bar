<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ArrowPathIcon, ComputerDesktopIcon } from '@heroicons/vue/16/solid'
import { useTinyBaseStore } from '@/hooks/useTinyBaseStore'
import {
	login,
	register,
	logout,
	logoutAll,
	getSessions,
	revokeSession,
	type SessionInfo,
} from '@/sync/auth'
import AppInput from '@/components/forms/AppInput.vue'
import AppButton from '@/components/AppButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import SegmentedControl from '@/components/forms/SegmentedControl.vue'

const { user, isLoggedIn, syncStatus, importLegacySessions } = useTinyBaseStore()

// ==================== Auth Form ====================

const mode = ref<'login' | 'register'>('login')
const modeOptions: { value: 'login' | 'register'; label: string }[] = [
	{ value: 'login', label: 'Sign in' },
	{ value: 'register', label: 'Create account' },
]
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const formError = ref('')
const formLoading = ref(false)

watch(mode, () => {
	formError.value = ''
})

async function handleSubmit() {
	formError.value = ''
	formLoading.value = true

	try {
		if (mode.value === 'register') {
			if (password.value.length < 8) {
				formError.value = 'Password must be at least 8 characters'
				return
			}
			if (password.value !== confirmPassword.value) {
				formError.value = 'Passwords do not match'
				return
			}
			await register(email.value, password.value)
		} else {
			await login(email.value, password.value)
		}
		// Reset form
		email.value = ''
		password.value = ''
		confirmPassword.value = ''
	} catch (e: unknown) {
		formError.value = e instanceof Error ? e.message : 'Something went wrong'
	} finally {
		formLoading.value = false
	}
}

// ==================== Sessions ====================

const sessions = ref<SessionInfo[]>([])
const sessionsLoading = ref(false)

async function loadSessions() {
	sessionsLoading.value = true
	try {
		sessions.value = await getSessions()
	} catch {
		// ignore
	} finally {
		sessionsLoading.value = false
	}
}

async function handleRevoke(sessionId: string) {
	await revokeSession(sessionId)
	await loadSessions()
}

async function handleLogout() {
	await logout()
	sessions.value = []
}

async function handleLogoutAll() {
	await logoutAll()
	sessions.value = []
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

const syncStatusLabel: Record<string, string> = {
	disconnected: 'Disconnected',
	connecting: 'Connecting…',
	connected: 'Connected',
	error: 'Error',
}

const syncStatusColor: Record<string, string> = {
	disconnected: 'bg-slate-400',
	connecting: 'bg-amber-400',
	connected: 'bg-green-500',
	error: 'bg-red-500',
}

// ==================== Legacy Import ====================

const importResult = ref<string | null>(null)
const importLoading = ref(false)

function handleImportLegacy() {
	importLoading.value = true
	importResult.value = null
	try {
		const count = importLegacySessions()
		if (count > 0) {
			importResult.value = `Imported ${count} session${count === 1 ? '' : 's'}. They will sync automatically.`
		} else {
			importResult.value = 'All sessions are already synced.'
		}
	} catch {
		importResult.value = 'Failed to import sessions.'
	} finally {
		importLoading.value = false
	}
}

onMounted(() => {
	if (isLoggedIn.value) {
		loadSessions()
	}
})
</script>

<template>
	<!-- Logged out: Auth Form -->
	<div v-if="!isLoggedIn" class="page-container py-12">
		<div class="mx-auto max-w-sm">
			<div class="mb-6 text-center">
				<img class="mx-auto size-10 rounded-lg" src="/assets/papaya-icon-next.png" alt="" />
				<h1
					class="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-white"
				>
					{{ mode === 'login' ? 'Sign in to Papaya' : 'Create your account' }}
				</h1>
				<p class="dark:text-vercel-accents-5 mt-1 text-sm text-slate-500">
					Sync your sessions and contexts across devices.
				</p>
			</div>

			<div class="card p-6">
				<SegmentedControl v-model="mode" label="Account" :options="modeOptions" block />

				<div
					v-if="formError"
					class="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
					role="alert"
				>
					{{ formError }}
				</div>

				<form class="mt-5 space-y-4" @submit.prevent="handleSubmit">
					<AppInput
						id="email"
						v-model="email"
						type="email"
						label="Email"
						autocomplete="email"
						required
					/>
					<AppInput
						id="password"
						v-model="password"
						type="password"
						label="Password"
						:autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
						required
					/>
					<AppInput
						v-if="mode === 'register'"
						id="confirm-password"
						v-model="confirmPassword"
						type="password"
						label="Confirm password"
						autocomplete="new-password"
						required
					/>

					<AppButton
						intent="primary"
						size="lg"
						type="submit"
						class="w-full"
						:disabled="formLoading"
					>
						{{
							formLoading
								? 'Just a moment…'
								: mode === 'login'
									? 'Sign in'
									: 'Create account'
						}}
					</AppButton>
				</form>
			</div>
		</div>
	</div>

	<!-- Logged in: Account Info -->
	<div v-else class="page-container py-8">
		<PageHeader title="Account" :description="user?.email">
			<template #actions>
				<AppButton @click="handleLogout">Sign out</AppButton>
			</template>
		</PageHeader>

		<div class="mt-8 max-w-3xl space-y-10">
			<section>
				<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Sync</h2>
				<div class="card dark:divide-vercel-accents-2 mt-3 divide-y divide-slate-100">
					<div class="flex items-center justify-between gap-6 px-5 py-4">
						<div>
							<p class="text-sm font-medium text-slate-900 dark:text-white">Status</p>
							<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
								Changes sync automatically while you're connected.
							</p>
						</div>
						<span
							class="dark:border-vercel-accents-2 dark:text-vercel-accents-7 inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700"
						>
							<span
								class="size-2 rounded-full"
								:class="syncStatusColor[syncStatus] ?? syncStatusColor.disconnected"
							/>
							{{ syncStatusLabel[syncStatus] ?? syncStatus }}
						</span>
					</div>
					<div class="px-5 py-4">
						<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<div class="min-w-60 flex-1">
								<p class="text-sm font-medium text-slate-900 dark:text-white">
									Sync older sessions
								</p>
								<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
									Upload sessions saved before sync was turned on. Already-synced
									sessions are skipped.
								</p>
							</div>
							<AppButton
								:disabled="importLoading || syncStatus !== 'connected'"
								@click="handleImportLegacy"
							>
								{{ importLoading ? 'Importing…' : 'Import & sync' }}
							</AppButton>
						</div>
						<p
							v-if="syncStatus !== 'connected'"
							class="mt-3 text-xs text-amber-600 dark:text-amber-400"
						>
							Sync needs to be connected to import sessions.
						</p>
						<div
							v-if="importResult"
							class="mt-3 rounded-md border px-3 py-2 text-sm"
							:class="
								importResult.startsWith('Failed')
									? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400'
									: 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400'
							"
						>
							{{ importResult }}
						</div>
					</div>
				</div>
			</section>

			<section>
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold text-slate-900 dark:text-white">
						Signed-in devices
					</h2>
					<AppButton
						intent="ghost"
						size="sm"
						:disabled="sessionsLoading"
						@click="loadSessions"
					>
						<ArrowPathIcon
							:class="['size-3.5', sessionsLoading ? 'animate-spin' : '']"
							aria-hidden="true"
						/>
						Refresh
					</AppButton>
				</div>
				<div class="card mt-3">
					<p
						v-if="sessionsLoading && !sessions.length"
						class="dark:text-vercel-accents-5 px-5 py-6 text-center text-sm text-slate-500"
					>
						Loading devices…
					</p>
					<ul
						v-else-if="sessions.length"
						role="list"
						class="dark:divide-vercel-accents-2 divide-y divide-slate-100"
					>
						<li
							v-for="session in sessions"
							:key="session.id"
							class="flex items-center gap-4 px-5 py-3"
						>
							<ComputerDesktopIcon
								class="dark:text-vercel-accents-5 size-4 shrink-0 text-slate-400"
								aria-hidden="true"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p
										class="truncate text-sm font-medium text-slate-900 dark:text-white"
									>
										{{ session.deviceName }}
									</p>
									<span
										v-if="session.isCurrent"
										class="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400"
									>
										This device
									</span>
								</div>
								<p class="dark:text-vercel-accents-5 mt-0.5 text-xs text-slate-500">
									Last active {{ timeAgo(session.lastActiveAt) }}
								</p>
							</div>
							<AppButton
								v-if="!session.isCurrent"
								intent="danger-ghost"
								size="sm"
								@click="handleRevoke(session.id)"
							>
								Revoke
							</AppButton>
						</li>
					</ul>
					<p
						v-else
						class="dark:text-vercel-accents-5 px-5 py-6 text-center text-sm text-slate-500"
					>
						No signed-in devices found.
					</p>
				</div>
				<div class="mt-3 flex justify-end">
					<AppButton intent="danger-ghost" size="sm" @click="handleLogoutAll">
						Sign out of all devices
					</AppButton>
				</div>
			</section>
		</div>
	</div>
</template>
