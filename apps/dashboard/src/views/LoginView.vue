<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const { login, isLoggedIn } = useAuth()
const router = useRouter()

if (isLoggedIn.value) {
	router.replace('/')
}

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
	error.value = ''
	loading.value = true
	try {
		await login(email.value, password.value)
		router.push('/')
	} catch (e: any) {
		error.value = e.message || 'Login failed'
	} finally {
		loading.value = false
	}
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center px-4">
		<div class="w-full max-w-sm">
			<div class="mb-8 text-center">
				<h1 class="text-3xl font-bold text-[#fb923c]">Papaya Bar</h1>
				<p class="mt-2 text-sm text-gray-400">Sign in to your dashboard</p>
			</div>

			<form
				@submit.prevent="handleSubmit"
				class="rounded-xl border border-gray-800 bg-gray-900 p-6"
			>
				<div
					v-if="error"
					class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
				>
					{{ error }}
				</div>

				<div class="mb-4">
					<label for="email" class="mb-1.5 block text-sm font-medium text-gray-300">
						Email
					</label>
					<input
						id="email"
						v-model="email"
						type="email"
						required
						autocomplete="email"
						class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 transition-colors outline-none focus:border-[#fb923c]"
						placeholder="you@example.com"
					/>
				</div>

				<div class="mb-6">
					<label for="password" class="mb-1.5 block text-sm font-medium text-gray-300">
						Password
					</label>
					<input
						id="password"
						v-model="password"
						type="password"
						required
						autocomplete="current-password"
						class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 transition-colors outline-none focus:border-[#fb923c]"
						placeholder="Enter your password"
					/>
				</div>

				<button
					type="submit"
					:disabled="loading"
					class="w-full rounded-lg bg-[#fb923c] px-4 py-2.5 text-sm font-medium text-gray-950 transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{{ loading ? 'Signing in...' : 'Sign In' }}
				</button>
			</form>
		</div>
	</div>
</template>
