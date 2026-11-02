<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
import { useRouter } from 'vue-router'

const { user, isAdmin, logout } = useAuth()
const router = useRouter()

async function handleSignOut() {
	await logout()
	router.push('/login')
}
</script>

<template>
	<header class="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
		<div class="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
			<RouterLink to="/" class="text-lg font-bold text-[#fb923c]">Papaya Bar</RouterLink>

			<span
				v-if="user"
				class="rounded-full px-2.5 py-0.5 text-xs font-medium"
				:class="isAdmin ? 'bg-[#fb923c]/15 text-[#fb923c]' : 'bg-gray-700 text-gray-300'"
			>
				{{ user.role === 'admin' ? 'Admin' : 'User' }}
			</span>

			<nav class="flex items-center gap-4 text-sm">
				<RouterLink
					to="/"
					class="transition-colors hover:text-[#fb923c]"
					active-class="text-[#fb923c]"
					:class="{ 'text-gray-400': $route.path !== '/' }"
				>
					Sessions
				</RouterLink>
				<RouterLink
					to="/account"
					class="transition-colors hover:text-[#fb923c]"
					active-class="text-[#fb923c]"
					:class="{ 'text-gray-400': $route.path !== '/account' }"
				>
					Account
				</RouterLink>
				<template v-if="isAdmin">
					<RouterLink
						to="/admin"
						class="transition-colors hover:text-[#fb923c]"
						active-class="text-[#fb923c]"
						:class="{ 'text-gray-400': $route.path !== '/admin' }"
					>
						Overview
					</RouterLink>
					<RouterLink
						to="/admin/users"
						class="transition-colors hover:text-[#fb923c]"
						active-class="text-[#fb923c]"
						:class="{ 'text-gray-400': $route.path !== '/admin/users' }"
					>
						Users
					</RouterLink>
					<RouterLink
						to="/admin/activity"
						class="transition-colors hover:text-[#fb923c]"
						active-class="text-[#fb923c]"
						:class="{ 'text-gray-400': $route.path !== '/admin/activity' }"
					>
						Activity
					</RouterLink>
				</template>
			</nav>

			<div class="ml-auto flex items-center gap-4 text-sm">
				<span class="text-gray-400">{{ user?.email }}</span>
				<button
					@click="handleSignOut"
					class="rounded-lg border border-gray-700 px-3 py-1.5 text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
				>
					Sign Out
				</button>
			</div>
		</div>
	</header>
</template>
