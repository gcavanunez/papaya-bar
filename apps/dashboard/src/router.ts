import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: '/login',
			component: () => import('@/views/LoginView.vue'),
		},
		{
			path: '/',
			component: () => import('@/views/SessionsView.vue'),
			meta: { requiresAuth: true },
		},
		{
			path: '/account',
			component: () => import('@/views/AccountView.vue'),
			meta: { requiresAuth: true },
		},
		{
			path: '/admin',
			component: () => import('@/views/AdminOverviewView.vue'),
			meta: { requiresAuth: true, requiresAdmin: true },
		},
		{
			path: '/admin/users',
			component: () => import('@/views/AdminUsersView.vue'),
			meta: { requiresAuth: true, requiresAdmin: true },
		},
		{
			path: '/admin/activity',
			component: () => import('@/views/AdminActivityView.vue'),
			meta: { requiresAuth: true, requiresAdmin: true },
		},
	],
})

router.beforeEach((to) => {
	const { isLoggedIn, isAdmin } = useAuth()

	if (to.meta.requiresAuth && !isLoggedIn.value) {
		return '/login'
	}

	if (to.meta.requiresAdmin && !isAdmin.value) {
		return '/'
	}
})

export default router
