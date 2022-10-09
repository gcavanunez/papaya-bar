<script setup lang="ts">
import { useChromeTabs } from '@/hooks/useChromeTabs'
import { router } from '@/router'
import {
	Menu,
	MenuButton,
	MenuItem,
	MenuItems,
	Popover,
	PopoverButton,
	PopoverPanel,
} from '@headlessui/vue'

import {
	ArrowTrendingUpIcon,
	Bars3Icon,
	BellIcon,
	FireIcon,
	HomeIcon,
	UserGroupIcon,
	XMarkIcon,
	SunIcon,
	MoonIcon,
} from '@heroicons/vue/24/outline'
import { computed } from 'vue'

import { ref } from 'vue'
import { Switch } from '@headlessui/vue'
import { useTitle } from '@vueuse/core'

const enabled = ref(false)
const user = {
	name: 'Chelsea Hagon',
	email: 'chelsea.hagon@example.com',
	imageUrl:
		'https://images.unsplash.com/photo-1550525811-e5869dd03032?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
}
const navigation = [
	{ name: 'Home', href: '#', icon: HomeIcon, current: true },
	{ name: 'Popular', href: '#', icon: FireIcon, current: false },
	{ name: 'Communities', href: '#', icon: UserGroupIcon, current: false },
	{ name: 'Trending', href: '#', icon: ArrowTrendingUpIcon, current: false },
]
const userNavigation = [
	{ name: 'Your Profile', href: '#' },
	{ name: 'Settings', href: '#' },
	{ name: 'Sign out', href: '#' },
]
const tabs = computed(() =>
	[
		{ name: 'Tabs', href: 'index', current: false },
		{ name: 'Sessions', href: 'sessions', current: false },
		{ name: 'Utils', href: 'utilities', current: false },
	].map((row) => ({
		...row,
		current: router.currentRoute.value.name == row.href,
	}))
)

const { loadedTabs, initlisteners } = useChromeTabs()
initlisteners()
const title = computed(() => {
	return `${loadedTabs.value.length}`
})
useTitle(title)
</script>

<template>
	<div class="min-h-full">
		<!-- When the mobile menu is open, add `overflow-hidden` to the `body` element to prevent double scrollbars -->
		<Popover as="template" v-slot="{ open }">
			<header
				:class="[
					open ? 'fixed inset-0 z-40 overflow-y-auto' : '',
					'bg-white shadow-sm lg:static lg:overflow-y-visible',
				]"
			>
				<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
					<div class="relative flex justify-between lg:gap-8 xl:grid xl:grid-cols-12">
						<div class="flex py-3 md:absolute md:inset-y-0 md:left-0 lg:static xl:col-span-2">
							<div class="flex flex-shrink-0 items-center">
								<a href="#">
									<!-- src="https://tailwindui.com/img/logos/workflow-mark.svg?color=rose&shade=500" -->
									<img
										class="block h-10 w-auto"
										src="/assets/papaya-icon-next.png"
										alt="Workflow"
									/>
								</a>
							</div>
						</div>
						<div class="min-w-0 flex-1 md:px-8 lg:px-0 xl:col-span-6">
							<div
								class="flex items-center px-6 py-4 md:mx-auto md:max-w-3xl lg:mx-0 lg:max-w-none xl:px-0"
							>
								<div class="w-full"></div>
							</div>
						</div>
						<div class="flex items-center md:absolute md:inset-y-0 md:right-0 lg:hidden">
							<!-- Mobile menu button -->
							<PopoverButton
								class="-mx-2 inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-rose-500"
							>
								<span class="sr-only">Open menu</span>
								<Bars3Icon v-if="!open" class="block h-6 w-6" aria-hidden="true" />
								<XMarkIcon v-else class="block h-6 w-6" aria-hidden="true" />
							</PopoverButton>
						</div>
						<div class="hidden lg:flex lg:items-center lg:justify-end xl:col-span-4">
							<a
								href="https://github.com/gcavanunez/unknown-tab"
								class="text-sm font-medium text-gray-900 hover:underline"
							>
								Github
							</a>
							<!-- <a
								href="#"
								class="ml-5 flex-shrink-0 rounded-full bg-white p-1 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
							>
								<span class="sr-only">View notifications</span>
								<BellIcon class="h-6 w-6" aria-hidden="true" />
							</a> -->

							<Switch
								v-model="enabled"
								:class="enabled ? 'bg-slate-700' : 'bg-slate-200'"
								class="relative ml-5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-papaya-900 focus-visible:ring-opacity-75"
							>
								<span class="sr-only">Use setting</span>
								<span
									aria-hidden="true"
									:class="
										enabled
											? 'translate-x-5 bg-black text-gray-200'
											: 'translate-x-0 bg-white text-gray-700'
									"
									class="pointer-events-none inline-flex h-5 w-5 transform items-center justify-center rounded-full shadow-2xl ring-0 transition duration-200 ease-in-out"
								>
									<MoonIcon class="h-4 w-4" v-if="enabled"></MoonIcon>
									<SunIcon class="h-4 w-4" v-else></SunIcon>
								</span>
							</Switch>

							<!-- Profile dropdown -->
							<Menu as="div" class="relative ml-5 flex-shrink-0">
								<div>
									<MenuButton
										class="flex items-center rounded-full bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
									>
										<span class="sr-only">Open user menu</span>
										<!-- <img class="h-8 w-8 rounded-full" :src="user.imageUrl" alt="" /> -->
										<BellIcon class="h-6 w-6" aria-hidden="true" />
										<span class="ml-1">{{ loadedTabs.length }}</span>
									</MenuButton>
								</div>
								<transition
									enter-active-class="transition ease-out duration-100"
									enter-from-class="transform opacity-0 scale-95"
									enter-to-class="transform opacity-100 scale-100"
									leave-active-class="transition ease-in duration-75"
									leave-from-class="transform opacity-100 scale-100"
									leave-to-class="transform opacity-0 scale-95"
								>
									<MenuItems
										class="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
									>
										<MenuItem v-for="item in userNavigation" :key="item.name" v-slot="{ active }">
											<a
												:href="item.href"
												:class="[
													active ? 'bg-gray-100' : '',
													'block py-2 px-4 text-sm text-gray-700',
												]"
												>{{ item.name }}</a
											>
										</MenuItem>
									</MenuItems>
								</transition>
							</Menu>
						</div>
					</div>
				</div>
				<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
					<nav class="relative z-0 flex" aria-label="Tabs">
						<!-- v-slot="{ href, route, navigate, isActive, isExactActive }" -->
						<router-link
							v-for="(tab, tabIdx) in tabs"
							:key="tab.name"
							:to="{ name: tab.href }"
							:aria-current="tab.current ? 'page' : undefined"
							:class="[
								tab.current ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700',

								'group relative px-1 pb-2 focus:z-10',
							]"
						>
							<span
								class="flex overflow-hidden rounded-lg bg-white py-2 px-3 text-center text-sm font-medium group-hover:bg-gray-50"
								>{{ tab.name }}</span
							>
							<span
								aria-hidden="true"
								:class="[
									tab.current ? 'bg-papaya-900' : 'bg-transparent',
									'absolute inset-x-0 bottom-0 h-0.5 ',
								]"
							/>
						</router-link>
					</nav>
				</div>

				<PopoverPanel as="nav" class="lg:hidden" aria-label="Global">
					<div class="mx-auto max-w-3xl space-y-1 px-2 pt-2 pb-3 sm:px-4">
						<a
							v-for="item in navigation"
							:key="item.name"
							:href="item.href"
							:aria-current="item.current ? 'page' : undefined"
							:class="[
								item.current ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-50',
								'block rounded-md py-2 px-3 text-base font-medium',
							]"
							>{{ item.name }}</a
						>
					</div>
					<div class="border-t border-gray-200 pt-4">
						<div class="mx-auto flex max-w-3xl items-center px-4 sm:px-6">
							<div class="flex-shrink-0">
								<img class="h-10 w-10 rounded-full" :src="user.imageUrl" alt="" />
							</div>
							<div class="ml-3">
								<div class="text-base font-medium text-gray-800">{{ user.name }}</div>
								<div class="text-sm font-medium text-gray-500">{{ user.email }}</div>
							</div>
							<button
								type="button"
								class="ml-auto flex-shrink-0 rounded-full bg-white p-1 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
							>
								<span class="sr-only">View notifications</span>
								<BellIcon class="h-6 w-6" aria-hidden="true" />
							</button>
						</div>
						<div class="mx-auto mt-3 max-w-3xl space-y-1 px-2 sm:px-4">
							<a
								v-for="item in userNavigation"
								:key="item.name"
								:href="item.href"
								class="block rounded-md py-2 px-3 text-base font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900"
								>{{ item.name }}</a
							>
						</div>
					</div>

					<div class="mx-auto mt-6 max-w-3xl px-4 sm:px-6">
						<a
							href="#"
							class="flex w-full items-center justify-center rounded-md border border-transparent bg-rose-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-rose-700"
						>
							New Post
						</a>

						<div class="mt-6 flex justify-center">
							<a
								href="https://github.com/gcavanunez/unknown-tab"
								class="text-base font-medium text-gray-900 hover:underline"
							>
								Github
							</a>
						</div>
					</div>
				</PopoverPanel>
			</header>
		</Popover>

		<div class="">
			<router-view />
		</div>
	</div>
</template>
