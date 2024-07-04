import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
	{
		path: '/',
		component: () => import('@/components/AppLayout.vue'),
		children: [
			{
				path: '',
				component: () => import('@/views/NextView.vue'),
				name: 'index',
			},
			{
				path: 'sessions',
				component: () => import('@/components/SimpleContainer.vue'),
				props: true,
				children: [
					{
						path: '',
						component: () => import('@/views/Sessions.vue'),
						name: 'sessions',
					},
					{
						path: ':uid',
						component: () => import('@/views/SessionsShow.vue'),
						name: 'sessions.show',
					},
				],
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
		],
	},

	{
		path: '/oldie',
		component: () => import('@/views/Index.vue'),
		name: 'oldie',
	},
	{
		path: '/popup',
		component: () => import('@/views/PopUp.vue'),
		name: 'popup',
	},
	{
		path: '/util-screenshot',
		component: () => import('@/views/UtilScreenshot.vue'),
	},
	{
		path: '/next',
		component: () => import('@/components/AppLayout.vue'),
		children: [
			{
				path: '',
				component: () => import('@/views/NextView.vue'),
				name: 'next-view',
			},
		],
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
				top: 72,
			}
		}
		return {
			top: 0,
			behavior: 'smooth',
		}
	},
})
