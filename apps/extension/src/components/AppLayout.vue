<script setup lang="ts">
import AppInput from './forms/AppInput.vue'
import AppModal from './AppModal.vue'
import AppButton from './AppButton.vue'
import AppMenuItems from './menu/AppMenuItems.vue'
import AppMenuItem from './menu/AppMenuItem.vue'
import DarkModeSwitch from './DarkModeSwitch.vue'
import CommandPalette from './CommandPalette.vue'
import { RadioGroup, RadioGroupLabel, RadioGroupOption } from '@headlessui/vue'
import { Menu, MenuButton, Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import {
	Bars3Icon,
	Cog6ToothIcon,
	CodeBracketIcon,
	MagnifyingGlassIcon,
	UserCircleIcon,
	XMarkIcon,
} from '@heroicons/vue/20/solid'
import { useTitle } from '@vueuse/core'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useChromeTabs } from '@/hooks/useChromeTabs'
import { useTinyBaseStore } from '@/hooks/useTinyBaseStore'
import { useGlobalModals } from '@/hooks/useGlobalModals'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { button } from '@/lib/ui'
import { isOwnExtensionUrl } from '@/lib/format'
import { paletteShortcutLabel } from '@/lib/platform'

const { open: openPalette } = useCommandPalette()
const { confirmModalToggle, confirmOptions, confirmAction, cancelAction } = useGlobalConfirm()
const { user, isLoggedIn, syncStatus } = useTinyBaseStore()
const { groupColors, groupModalToggle, groupModalForm, onGroupFormSummit, mode } = useGlobalModals()

const commit_hash = __COMMIT_HASH__
const route = useRoute()

const navigation = [
	{ name: 'Tabs', route: 'index' },
	{ name: 'History', route: 'history' },
	{ name: 'Sessions', route: 'sessions' },
	{ name: 'Utilities', route: 'utilities' },
]
const isCurrent = (name: string) => {
	const current = String(route.name ?? '')
	return current === name || current.startsWith(`${name}.`)
}

const syncDot: Record<string, string> = {
	connected: 'bg-green-500',
	connecting: 'bg-amber-400',
	disconnected: 'bg-slate-400',
	error: 'bg-red-500',
}

const { loadedTabs, initlisteners } = useChromeTabs()
initlisteners()
const tabCount = computed(
	() => loadedTabs.value.filter((tab) => !isOwnExtensionUrl(tab.url)).length,
)
const title = computed(() => {
	return `${tabCount.value}`
})
useTitle(title)
</script>

<template>
	<div class="flex min-h-full flex-1 flex-col">
		<Popover v-slot="{ open, close }" as="template">
			<header
				class="dark:border-vercel-accents-2 sticky top-0 z-50 h-(--app-header-height) border-b border-slate-200 bg-white/90 backdrop-blur dark:bg-black/90"
			>
				<div class="page-container flex h-full items-center gap-6">
					<router-link
						:to="{ name: 'index' }"
						class="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
					>
						<img class="size-7 rounded-md" src="/assets/papaya-icon-next.png" alt="" />
						<span class="text-sm font-semibold text-slate-900 dark:text-white">
							Papaya
						</span>
					</router-link>

					<nav class="hidden h-full items-stretch md:flex" aria-label="Main">
						<router-link
							v-for="item in navigation"
							:key="item.route"
							:to="{ name: item.route }"
							:aria-current="isCurrent(item.route) ? 'page' : undefined"
							:class="[
								'group relative flex items-center gap-1.5 px-3 text-sm font-medium transition-colors focus-visible:outline-none',
								isCurrent(item.route)
									? 'text-slate-900 dark:text-white'
									: 'dark:text-vercel-accents-5 text-slate-500 hover:text-slate-900 dark:hover:text-white',
							]"
						>
							<span
								class="rounded-md px-0.5 group-focus-visible:outline-2 group-focus-visible:outline-blue-500"
							>
								{{ item.name }}
							</span>
							<span
								v-if="item.route === 'index' && tabCount"
								class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-500 tabular-nums"
							>
								{{ tabCount }}
							</span>
							<span
								aria-hidden="true"
								:class="[
									isCurrent(item.route) ? 'bg-papaya-900' : 'bg-transparent',
									'absolute inset-x-3 -bottom-px h-0.5 rounded-full',
								]"
							/>
						</router-link>
					</nav>

					<div class="ml-auto flex items-center gap-1">
						<button
							type="button"
							:class="[
								button({ intent: 'secondary', size: 'md' }),
								'dark:text-vercel-accents-5 mr-1 hidden w-56 justify-start text-slate-500 sm:inline-flex',
							]"
							@click="openPalette"
						>
							<MagnifyingGlassIcon class="size-4" aria-hidden="true" />
							<span class="font-normal">Jump to…</span>
							<kbd class="kbd ml-auto">{{ paletteShortcutLabel }}</kbd>
						</button>

						<DarkModeSwitch />

						<Menu as="div" class="relative">
							<MenuButton
								:class="[
									button({ intent: 'ghost', size: 'md', square: true }),
									'relative',
								]"
							>
								<span class="sr-only">Open account menu</span>
								<UserCircleIcon class="size-5" aria-hidden="true" />
								<span
									v-if="isLoggedIn"
									:class="[
										syncDot[syncStatus] ?? syncDot.disconnected,
										'absolute top-1 right-1 size-2 rounded-full ring-2 ring-white dark:ring-black',
									]"
								/>
							</MenuButton>
							<AppMenuItems width="w-60">
								<div class="px-2.5 pt-1.5 pb-2">
									<p
										class="truncate text-sm font-medium text-slate-900 dark:text-white"
									>
										{{ isLoggedIn ? user?.email : 'Not signed in' }}
									</p>
									<p class="dark:text-vercel-accents-5 text-xs text-slate-500">
										{{
											isLoggedIn
												? `Sync ${syncStatus}`
												: 'Sign in to sync across devices'
										}}
									</p>
								</div>
								<div class="menu-separator" />
								<AppMenuItem :icon="UserCircleIcon" :to="{ name: 'account' }">
									Account
								</AppMenuItem>
								<AppMenuItem :icon="Cog6ToothIcon" :to="{ name: 'settings' }">
									Settings
								</AppMenuItem>
								<div class="menu-separator" />
								<AppMenuItem
									:icon="CodeBracketIcon"
									href="https://github.com/gcavanunez/unknown-tab"
								>
									GitHub
									<template #trailing>
										<span
											class="dark:text-vercel-accents-4 font-mono text-[11px] text-slate-400"
										>
											{{ commit_hash }}
										</span>
									</template>
								</AppMenuItem>
							</AppMenuItems>
						</Menu>

						<PopoverButton
							:class="[
								button({ intent: 'ghost', size: 'md', square: true }),
								'md:hidden',
							]"
						>
							<span class="sr-only">Open navigation</span>
							<Bars3Icon v-if="!open" class="size-5" aria-hidden="true" />
							<XMarkIcon v-else class="size-5" aria-hidden="true" />
						</PopoverButton>
					</div>
				</div>

				<PopoverPanel
					as="nav"
					aria-label="Mobile"
					class="dark:border-vercel-accents-2 absolute inset-x-0 top-full border-b border-slate-200 bg-white shadow-lg md:hidden dark:bg-black"
				>
					<div class="page-container space-y-0.5 py-2">
						<router-link
							v-for="item in navigation"
							:key="item.route"
							:to="{ name: item.route }"
							:class="[
								isCurrent(item.route)
									? 'dark:bg-vercel-accents-2 bg-slate-100 text-slate-900 dark:text-white'
									: 'dark:text-vercel-accents-5 dark:hover:bg-vercel-accents-1 text-slate-600 hover:bg-slate-50',
								'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium',
							]"
							@click="close()"
						>
							{{ item.name }}
							<span
								v-if="item.route === 'index'"
								class="dark:text-vercel-accents-5 text-xs text-slate-400 tabular-nums"
							>
								{{ tabCount }}
							</span>
						</router-link>
					</div>
				</PopoverPanel>
			</header>
		</Popover>

		<main class="flex flex-1 flex-col">
			<AppModal
				v-model="groupModalToggle"
				:title="mode === 'edit' ? 'Edit tab group' : 'New tab group'"
			>
				<form class="space-y-5" @submit.prevent="onGroupFormSummit">
					<AppInput
						id="group-title"
						v-model="groupModalForm.title"
						type="text"
						label="Name"
						placeholder="e.g. Research"
					/>
					<RadioGroup v-model="groupModalForm.color">
						<RadioGroupLabel
							class="dark:text-vercel-accents-7 mb-2 block text-sm font-medium text-slate-700"
						>
							Color
						</RadioGroupLabel>
						<div class="flex flex-wrap items-center gap-2.5">
							<RadioGroupOption
								v-for="color in groupColors"
								:key="color.hex"
								v-slot="{ checked }"
								as="template"
								:value="color.value"
							>
								<button
									type="button"
									:title="color.value"
									:class="[
										checked
											? 'ring-2 ring-slate-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-black'
											: 'ring-1 ring-black/10 dark:ring-white/10',
										'size-7 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500',
									]"
									:style="{ backgroundColor: color.hex }"
								>
									<span class="sr-only">{{ color.value }}</span>
								</button>
							</RadioGroupOption>
						</div>
					</RadioGroup>
					<div class="flex justify-end gap-2 pt-1">
						<AppButton @click="groupModalToggle = false">Cancel</AppButton>
						<AppButton intent="primary" type="submit">
							{{ mode === 'edit' ? 'Save changes' : 'Create group' }}
						</AppButton>
					</div>
				</form>
			</AppModal>

			<AppModal
				v-slot="slotProps"
				v-model="confirmModalToggle"
				:title="confirmOptions.title"
				:description="confirmOptions.message"
			>
				<div class="flex justify-end gap-2">
					<AppButton
						:ref="
							(el) =>
								slotProps.trigger(
									el && '$el' in el
										? (el.$el as HTMLElement)
										: (el as HTMLElement),
								)
						"
						@click="cancelAction"
					>
						Cancel
					</AppButton>
					<AppButton
						:intent="confirmOptions.destructive ? 'danger' : 'primary'"
						@click="confirmAction"
					>
						{{ confirmOptions.confirmLabel }}
					</AppButton>
				</div>
			</AppModal>

			<router-view />
		</main>

		<CommandPalette />
	</div>
</template>
