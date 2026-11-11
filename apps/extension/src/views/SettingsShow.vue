<script setup lang="ts">
import { SwitchDescription, SwitchGroup, SwitchLabel } from '@headlessui/vue'
import { onMounted, ref } from 'vue'
import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
	ComputerDesktopIcon,
	MoonIcon,
	SunIcon,
} from '@heroicons/vue/16/solid'
import { useColorMode } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useSettings } from '@/hooks/useSettings'
import { useGlobalConfirm } from '@/hooks/useGlobalConfirm'
import {
	downloadBackup,
	getBackupStats,
	importBackup,
	type BackupStats,
	type ImportMode,
} from '@/lib/dataBackup'
import { pluralize } from '@/lib/format'
import AppButton from '@/components/AppButton.vue'
import AppSwitch from '@/components/forms/AppSwitch.vue'
import PageHeader from '@/components/PageHeader.vue'
import SegmentedControl from '@/components/forms/SegmentedControl.vue'

const { settings, loadSettings } = useSettings()
const { triggerConfirm } = useGlobalConfirm()

// Same storage key as the header toggle (useDark), so both stay in sync
const { store: theme } = useColorMode({ modes: { light: '', dark: 'dark' } })
const themeOptions: { value: 'light' | 'dark' | 'auto'; label: string; icon: typeof SunIcon }[] = [
	{ value: 'light', label: 'Light', icon: SunIcon },
	{ value: 'dark', label: 'Dark', icon: MoonIcon },
	{ value: 'auto', label: 'System', icon: ComputerDesktopIcon },
]

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const stats = ref<BackupStats | null>(null)
const importMode = ref<ImportMode>('merge')
const importModeOptions: { value: ImportMode; label: string }[] = [
	{ value: 'merge', label: 'Merge' },
	{ value: 'replace', label: 'Replace' },
]

function formatBytes(b: number): string {
	if (b < 1024) return `${b} B`
	if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
	return `${(b / 1024 / 1024).toFixed(1)} MB`
}

async function refreshStats() {
	try {
		stats.value = await getBackupStats()
	} catch (e) {
		console.error(e)
	}
}

onMounted(() => {
	loadSettings()
	void refreshStats()
})

async function onDownload() {
	busy.value = true
	try {
		await downloadBackup()
		toast('Backup downloaded')
	} catch (e) {
		console.error(e)
		toast.error('Export failed')
	} finally {
		busy.value = false
	}
}

function pickFile() {
	fileInput.value?.click()
}

async function runImport(file: File) {
	busy.value = true
	try {
		const summary = await importBackup(file, importMode.value)
		toast(
			`Imported ${pluralize(summary.sessions, 'session')} and ${pluralize(summary.versions, 'version')}. Reloading…`,
		)
		setTimeout(() => location.reload(), 900)
	} catch (e) {
		console.error(e)
		toast.error(e instanceof Error ? e.message : 'Import failed')
	} finally {
		busy.value = false
	}
}

function onFileChange(e: Event) {
	const input = e.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = '' // allow re-picking the same file
	if (!file) return
	if (importMode.value === 'merge') {
		triggerConfirm(() => void runImport(file), {
			title: 'Merge this backup?',
			message: 'Existing items are kept; the backup wins when both have the same item.',
			confirmLabel: 'Merge backup',
			destructive: false,
		})
	} else {
		triggerConfirm(() => void runImport(file), {
			title: 'Replace all your data?',
			message:
				'Every session on this device will be replaced by the backup. Download a backup first if you might want them back.',
			confirmLabel: 'Replace everything',
		})
	}
}
</script>
<template>
	<div class="page-container py-8">
		<PageHeader
			title="Settings"
			description="Preferences for how Papaya behaves on this device."
		/>

		<div class="mt-8 max-w-3xl space-y-10">
			<section>
				<h2 class="text-sm font-semibold text-slate-900 dark:text-white">General</h2>
				<div class="card dark:divide-vercel-accents-2 mt-3 divide-y divide-slate-100">
					<SwitchGroup as="div" class="flex items-center justify-between gap-6 px-5 py-4">
						<div class="min-w-60 flex-1">
							<SwitchLabel
								as="p"
								class="text-sm font-medium text-slate-900 dark:text-white"
								passive
							>
								Copy links as Markdown
							</SwitchLabel>
							<SwitchDescription
								class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500"
							>
								Copied links use
								<code
									class="dark:bg-vercel-accents-2 rounded bg-slate-100 px-1 py-px font-mono text-xs"
									>[Title](url)</code
								>
								instead of the title and URL on separate lines.
							</SwitchDescription>
						</div>
						<AppSwitch v-model="settings.copyLinksInMarkdownFormat" />
					</SwitchGroup>
					<div
						class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
					>
						<div class="min-w-60 flex-1">
							<p class="text-sm font-medium text-slate-900 dark:text-white">Theme</p>
							<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
								Use light or dark mode, or follow your system setting.
							</p>
						</div>
						<SegmentedControl
							v-model="theme"
							label="Theme"
							:options="themeOptions"
							size="sm"
						/>
					</div>
				</div>
			</section>

			<section>
				<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Your data</h2>
				<p class="dark:text-vercel-accents-5 mt-1 text-sm text-slate-500">
					Everything is stored locally on this device. Backups exclude your login token.
				</p>
				<div class="card dark:divide-vercel-accents-2 mt-3 divide-y divide-slate-100">
					<div
						class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
					>
						<div class="min-w-60 flex-1">
							<p class="text-sm font-medium text-slate-900 dark:text-white">
								Download a backup
							</p>
							<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
								<template v-if="stats">
									{{ pluralize(stats.sessions, 'session') }} ·
									{{ pluralize(stats.versions, 'version') }} ·
									{{ formatBytes(stats.bytes) }}
								</template>
								<template v-else>Calculating…</template>
							</p>
						</div>
						<AppButton :disabled="busy" @click="onDownload">
							<ArrowDownTrayIcon class="size-4" aria-hidden="true" />
							Download
						</AppButton>
					</div>
					<div
						class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
					>
						<div class="min-w-60 flex-1">
							<p class="text-sm font-medium text-slate-900 dark:text-white">
								Restore from a backup
							</p>
							<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
								<span class="font-medium text-slate-700 dark:text-slate-200"
									>Merge</span
								>
								adds the backup to what you have;
								<span class="font-medium text-slate-700 dark:text-slate-200"
									>Replace</span
								>
								overwrites everything.
							</p>
						</div>
						<div class="flex items-center gap-2">
							<SegmentedControl
								v-model="importMode"
								label="Import mode"
								:options="importModeOptions"
								size="sm"
							/>
							<AppButton :disabled="busy" @click="pickFile">
								<ArrowUpTrayIcon class="size-4" aria-hidden="true" />
								Import…
							</AppButton>
						</div>
						<input
							ref="fileInput"
							type="file"
							accept="application/json,.json"
							class="hidden"
							@change="onFileChange"
						/>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>
