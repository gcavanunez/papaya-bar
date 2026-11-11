import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
const routes: RouteRecordRaw[] = [
	{
		path: '/',
		component: () => import('@/components/AppLayout.vue'),
		children: [
			{
				path: '',
				component: () => import('@/views/Index.vue'),
				name: 'index',
			},
			{
				path: 'sessions',
				component: () => import('@/components/SimpleContainer.vue'),
				props: true,
				children: [
					{
						path: '',
						component: () => import('@/views/SessionsIndex.vue'),
						name: 'sessions',
					},
					{
						path: ':uid',
						component: () => import('@/views/SessionsShow.vue'),
						name: 'sessions.show',
						props: true,
					},
				],
			},
			{
				path: 'history',
				component: () => import('@/views/History.vue'),
				name: 'history',
			},
			{
				path: 'utilities',
				component: () => import('@/views/Utilities.vue'),
				name: 'utilities',
			},
			{
				path: 'settings',
				component: () => import('@/views/SettingsShow.vue'),
				name: 'settings',
			},
			{
				path: 'account',
				component: () => import('@/views/AccountView.vue'),
				name: 'account',
			},
		],
	},
	{
		path: '/popup',
		component: () => import('@/views/PopUp.vue'),
		name: 'popup',
	},
	{
		path: '/panel',
		component: () => import('@/views/SessionPanel.vue'),
		name: 'panel',
	},
	{
		path: '/util-screenshot',
		component: () => import('@/views/UtilScreenshot.vue'),
	},
]

export const router = createRouter({
	history: createWebHashHistory(),
	routes,
	scrollBehavior(to) {
		if (to.hash) {
			return {
				el: to.hash,
				behavior: 'smooth',
				top: 64,
			}
		}
		return {
			top: 0,
			behavior: 'smooth',
		}
	},
})
