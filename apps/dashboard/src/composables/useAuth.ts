import { ref, computed } from 'vue'
import { login as apiLogin, verify, logout as apiLogout, type AuthUser } from '@/api'

const token = ref<string | null>(null)
const user = ref<AuthUser | null>(null)

// Restore from sessionStorage
const saved = sessionStorage.getItem('dashboard_session')
if (saved) {
	try {
		const parsed = JSON.parse(saved)
		token.value = parsed.token
		user.value = parsed.user
	} catch {
		sessionStorage.removeItem('dashboard_session')
	}
}

export function useAuth() {
	const isLoggedIn = computed(() => !!token.value && !!user.value)
	const isAdmin = computed(() => user.value?.role === 'admin')

	async function login(email: string, password: string) {
		const data = await apiLogin(email, password)
		token.value = data.token
		user.value = data.user
		sessionStorage.setItem('dashboard_session', JSON.stringify(data))
	}

	async function logout() {
		if (token.value) {
			await apiLogout(token.value)
		}
		token.value = null
		user.value = null
		sessionStorage.removeItem('dashboard_session')
	}

	async function verifySession(): Promise<boolean> {
		if (!token.value) return false
		try {
			const data = await verify(token.value)
			if (data.valid && data.user) {
				user.value = data.user
				sessionStorage.setItem(
					'dashboard_session',
					JSON.stringify({ token: token.value, user: data.user }),
				)
				return true
			}
		} catch {
			// ignore
		}
		token.value = null
		user.value = null
		sessionStorage.removeItem('dashboard_session')
		return false
	}

	return {
		token,
		user,
		isLoggedIn,
		isAdmin,
		login,
		logout,
		verifySession,
	}
}
