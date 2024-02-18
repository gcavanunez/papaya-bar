import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";

// 2. Define some routes
// Each route should map to a component.
// We'll talk about nested routes later.
const routes: RouteRecordRaw[] = [
	{
		path: "/",
		component: () => import("@/components/AppLayout.vue"),
		children: [
			{
				path: "",
				component: () => import("@/views/NextView.vue"),
				name: "index",
			},
			{
				path: "sessions",
				component: () => import("@/components/SimpleContainer.vue"),
				props: true,
				children: [
					{
						path: "",
						component: () => import("@/views/Sessions.vue"),
						name: "sessions",
					},
					{
						path: ":uid",
						component: () => import("@/views/SessionsShow.vue"),
						name: "sessions.show",
					},
				],
			},
			{
				path: "utilities",
				component: () => import("@/views/Utilities.vue"),
				name: "utilities",
			},
		],
	},

	{
		path: "/oldie",
		component: () => import("@/views/Index.vue"),
		name: "oldie",
	},
	// { path: '/sessions', component: () => import('@/views/Sessions.vue'), name: 'sessions' },
	// { path: '/utilities', component: () => import('@/views/Utilities.vue'), name: 'utilities' },
	{
		path: "/popup",
		component: () => import("@/views/PopUp.vue"),
		name: "popup",
	},
	{
		path: "/util-screenshot",
		component: () => import("@/views/UtilScreenshot.vue"),
	},
	{
		path: "/next",
		component: () => import("@/components/AppLayout.vue"),
		children: [
			{
				path: "",
				component: () => import("@/views/NextView.vue"),
				name: "next-view",
			},
		],
	},
];

// 3. Create the router instance and pass the `routes` option
// You can pass in additional options here, but let's
// keep it simple for now.
export const router = createRouter({
	// 4. Provide the history implementation to use. We are using the hash history for simplicity here.
	history: createWebHashHistory(),
	routes, // short for `routes: routes`
	scrollBehavior(to, from, savedPosition) {
		if (to.hash) {
			return {
				el: to.hash,
				behavior: "smooth",
				top: 72,
			};
		}
		return {
			top: 0,
			behavior: "smooth",
		};
	},
});
