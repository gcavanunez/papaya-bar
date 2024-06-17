<script setup lang="ts">
import AppInput from './forms/AppInput.vue'
import AppModal from './AppModal.vue'
import { RadioGroup, RadioGroupLabel, RadioGroupOption } from '@headlessui/vue'
import AppButton from './AppButton.vue'

import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useGlobalModals } from '@/hooks/useGlobalModals'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
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
	RectangleStackIcon,
	FireIcon,
	HomeIcon,
	UserGroupIcon,
	XMarkIcon,
} from '@heroicons/vue/24/outline'

import { useTitle } from '@vueuse/core'
import { computed } from 'vue'
import DarkModeSwitch from './DarkModeSwitch.vue'
const { confirmModalToggle, confirmAction, cancelAction } = useGlobalConfirm()

const { groupColors, groupModalToggle, groupModalForm, onGroupFormSummit } = useGlobalModals()

const commit_hash = __COMMIT_HASH__

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
	{ name: 'Other Devices', href: '#' },
	{ name: 'Settings', href: '#' },
	// { name: 'Sign out', href: '#' },
]
const tabs = computed(() =>
	[
		{ name: 'Tabs', href: 'index', current: false },
		{ name: 'Sessions', href: 'sessions', current: false },
		{ name: 'Utils', href: 'utilities', current: false },
	].map((row) => ({
		...row,
		current: router.currentRoute.value.name == row.href,
	})),
)

const { loadedTabs, initlisteners } = useChromeTabs()
initlisteners()
const title = computed(() => {
	return `${loadedTabs.value.length}`
})
useTitle(title)
</script>

<template>
	<div class="flex min-h-full flex-1 flex-col">
		<!-- When the mobile menu is open, add `overflow-hidden` to the `body` element to prevent double scrollbars -->
		<!-- v-slot="{ href, route, navigate, isActive, isExactActive }" -->
		<Popover v-slot="{ open }" as="template">
			<header
				:class="[
					open ? 'fixed inset-0 z-40 overflow-y-auto' : '',
					'firefox:bg-opacity-90 sticky top-0 z-50  h-[72px] bg-white bg-opacity-50 shadow-sm  backdrop-blur backdrop-filter dark:bg-black  dark:bg-opacity-20 lg:overflow-y-visible',
				]"
			>
				<div class="mx-auto h-full max-w-7xl px-4 sm:px-6 lg:px-8">
					<div
						class="relative flex h-full justify-between lg:gap-8 xl:grid xl:grid-cols-12"
					>
						<div
							class="flex md:absolute md:inset-y-0 md:left-0 lg:static xl:col-span-2"
						>
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
						<div class="h-full min-w-0 flex-1 md:px-8 lg:px-0 xl:col-span-6">
							<div
								class="flex h-full items-center px-6 md:mx-auto md:max-w-3xl lg:mx-0 lg:max-w-none xl:px-0"
							>
								<div class="h-full w-full">
									<nav
										class="relative z-0 flex h-full w-full items-end"
										aria-label="Tabs"
									>
										<router-link
											v-for="(tab, tabIdx) in tabs"
											:key="tab.name"
											:to="{ name: tab.href }"
											:aria-current="tab.current ? 'page' : undefined"
											:class="[
												tab.current
													? 'text-gray-900 dark:text-white'
													: 'text-gray-500 hover:text-gray-700 dark:text-vercel-accents-5 dark:hover:text-white',

												'group relative h-full px-1 py-4 focus:z-10',
											]"
										>
											<span
												class="flex overflow-hidden rounded-lg px-3 py-2 text-center text-sm font-medium transition group-hover:bg-gray-50 dark:bg-transparent dark:group-hover:bg-vercel-accents-2"
											>
												{{ tab.name }}
											</span>
											<span
												aria-hidden="true"
												:class="[
													tab.current
														? 'bg-papaya-900'
														: 'bg-transparent',
													'absolute inset-x-0 bottom-0 h-0.5 ',
												]"
											/>
										</router-link>
									</nav>
								</div>
							</div>
						</div>
						<div
							class="flex items-center md:absolute md:inset-y-0 md:right-0 lg:hidden"
						>
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
								class="text-sm font-medium text-gray-900 hover:underline dark:text-white"
							>
								Github - {{ commit_hash }}
							</a>
							<!-- <a
								href="#"
								class="ml-5 flex-shrink-0 rounded-full bg-white p-1 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
							>
								<span class="sr-only">View notifications</span>
								<RectangleStackIcon class="h-6 w-6" aria-hidden="true" />
							</a> -->
							<DarkModeSwitch />

							<!-- Profile dropdown -->
							<Menu as="div" class="relative ml-5 flex-shrink-0">
								<div>
									<MenuButton
										class="flex items-center rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-papaya-900 focus:ring-offset-2 dark:text-vercel-accents-5 dark:hover:text-white dark:focus:ring-offset-black"
									>
										<span class="sr-only">Open user menu</span>
										<RectangleStackIcon class="h-6 w-6" aria-hidden="true" />
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
										<MenuItem
											v-for="item in userNavigation"
											:key="item.name"
											v-slot="{ active }"
										>
											<a
												:href="item.href"
												:class="[
													active ? 'bg-gray-100' : '',
													'block px-4 py-2 text-sm text-gray-700',
												]"
											>
												{{ item.name }}
											</a>
										</MenuItem>
									</MenuItems>
								</transition>
							</Menu>
						</div>
					</div>
				</div>
				<!-- <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
					<nav class="relative z-0 flex" aria-label="Tabs">
						<router-link
							v-for="(tab, tabIdx) in tabs"
							:key="tab.name"
							:to="{ name: tab.href }"
							:aria-current="tab.current ? 'page' : undefined"
							:class="[
								tab.current
									? 'text-gray-900 dark:text-white'
									: 'text-gray-500 hover:text-gray-700 dark:text-vercel-accents-5 dark:hover:text-white',

								'group relative px-1 pb-2 focus:z-10',
							]"
						>
							<span
								class="flex overflow-hidden rounded-lg bg-white py-2 px-3 text-center text-sm font-medium transition group-hover:bg-gray-50 dark:bg-transparent dark:group-hover:bg-vercel-accents-2"
							>
								{{ tab.name }}
							</span>
							<span
								aria-hidden="true"
								:class="[
									tab.current ? 'bg-papaya-900' : 'bg-transparent',
									'absolute inset-x-0 bottom-0 h-0.5 ',
								]"
							/>
						</router-link>
					</nav>
				</div> -->

				<PopoverPanel as="nav" class="lg:hidden" aria-label="Global">
					<div class="mx-auto max-w-3xl space-y-1 px-2 pb-3 pt-2 sm:px-4">
						<a
							v-for="item in navigation"
							:key="item.name"
							:href="item.href"
							:aria-current="item.current ? 'page' : undefined"
							:class="[
								item.current ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-50',
								'block rounded-md px-3 py-2 text-base font-medium',
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
								<div class="text-base font-medium text-gray-800">
									{{ user.name }}
								</div>
								<div class="text-sm font-medium text-gray-500">
									{{ user.email }}
								</div>
							</div>
							<button
								type="button"
								class="ml-auto flex-shrink-0 rounded-full bg-white p-1 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
							>
								<span class="sr-only">View notifications</span>
								<RectangleStackIcon class="h-6 w-6" aria-hidden="true" />
							</button>
						</div>
						<div class="mx-auto mt-3 max-w-3xl space-y-1 px-2 sm:px-4">
							<a
								v-for="item in userNavigation"
								:key="item.name"
								:href="item.href"
								class="block rounded-md px-3 py-2 text-base font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900"
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
								class="text-base font-medium text-gray-900 hover:underline dark:text-white"
							>
								Github
							</a>
						</div>
					</div>
				</PopoverPanel>
			</header>
		</Popover>

		<main class="flex flex-1 flex-col">
			<AppModal v-model="groupModalToggle" title="Group Settings">
				<form @submit.prevent="onGroupFormSummit">
					<div class="mt-8 grid grid-cols-1 gap-6">
						<div>
							<AppInput
								v-model="groupModalForm.title"
								type="text"
								class="dark:bg-black"
								label="Group label"
							/>
						</div>
						<div>
							<!-- <input v-model="groupModalForm.color" class="dark:bg-black" /> -->
							<div>
								<h2 class="text-sm font-medium text-gray-900 dark:text-white">
									Color
								</h2>

								<RadioGroup v-model="groupModalForm.color" class="mt-2">
									<RadioGroupLabel class="sr-only">
										Choose a color
									</RadioGroupLabel>
									<div class="flex flex-wrap items-center gap-3">
										<RadioGroupOption
											v-for="color in groupColors"
											:key="color.hex"
											v-slot="{ active, checked }"
											as="template"
											:value="color.value"
										>
											<div
												:class="[
													color.selectedColor,
													active && checked ? 'ring ring-offset-1' : '',
													!active && checked ? 'ring-2' : '',
													'relative -m-0.5 flex cursor-pointer items-center justify-center rounded-full p-0.5 focus:outline-none',
												]"
											>
												<RadioGroupLabel as="span" class="sr-only">
													{{ color.value }}
												</RadioGroupLabel>
												<span
													aria-hidden="true"
													:class="[
														color.bgColor,
														'h-8 w-8 rounded-full border border-black border-opacity-10',
													]"
												/>
											</div>
										</RadioGroupOption>
									</div>
								</RadioGroup>
							</div>
						</div>
						<div class="flex justify-end">
							<AppButton intent="primary" size="medium" type="submit">Save</AppButton>
						</div>
					</div>
				</form>
			</AppModal>

			<!-- Group Settings Modal -->
			<!-- Session Modal -->
			<AppModal v-slot="slotProps" v-model="confirmModalToggle" title="Confirm action">
				<div class="mt-2">
					<p class="text-sm text-slate-500 dark:text-slate-400">
						This action cannot be undone.
					</p>
				</div>

				<div class="mt-4 space-x-4">
					<AppButton intent="primary" size="medium" type="button" @click="confirmAction">
						Confirm
					</AppButton>
					<AppButton
						:ref="(el) => slotProps.trigger(el)"
						intent="secondary"
						size="medium"
						type="button"
						@click="cancelAction"
					>
						Cancel
					</AppButton>
				</div>
			</AppModal>
			<!-- confirm  -->
			<router-view />
		</main>
	</div>
</template>
