<script setup lang="ts">
/**
 * Settings → Smart group: pair with an opencode server so Smart group can use the model
 * it's set up with.
 */
import { onMounted, ref, watch } from 'vue'
import { SwitchDescription, SwitchGroup, SwitchLabel } from '@headlessui/vue'
import { toast } from 'vue-sonner'
import {
	checkConnection,
	disconnect,
	loadConnection,
	pair,
	updateConnection,
	type OpencodeConnection,
} from '@/lib/opencode'
import AppButton from '@/components/AppButton.vue'
import AppSwitch from '@/components/forms/AppSwitch.vue'

const connection = ref<OpencodeConnection | null>(null)
const enabled = ref(false)
const link = ref('')
const busy = ref(false)
const error = ref('')
const problem = ref('')

async function load() {
	connection.value = await loadConnection()
	enabled.value = !!connection.value?.enabled
	problem.value = ''
	if (!connection.value) return
	try {
		// Refresh the version and model, and notice an expired pairing early
		const details = await checkConnection(connection.value)
		await updateConnection(details)
		connection.value = { ...connection.value, ...details }
	} catch (e) {
		problem.value = e instanceof Error ? e.message : String(e)
	}
}

async function connect() {
	busy.value = true
	error.value = ''
	try {
		connection.value = await pair(link.value)
		enabled.value = true
		problem.value = ''
		link.value = ''
		toast(`Paired with opencode. Smart group now uses ${connection.value.model}.`)
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e)
	} finally {
		busy.value = false
	}
}

async function forget() {
	await disconnect()
	connection.value = null
	enabled.value = false
	toast('Disconnected from opencode')
}

watch(enabled, (on) => {
	if (connection.value && connection.value.enabled !== on) {
		connection.value = { ...connection.value, enabled: on }
		void updateConnection({ enabled: on })
	}
})

onMounted(load)
</script>

<template>
	<section>
		<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Smart group</h2>
		<p class="dark:text-vercel-accents-5 mt-1 text-sm text-slate-500">
			Group tabs by topic with the model your opencode server uses. Without it, Smart group
			uses Chrome's on-device model when it's ready, and groups by site otherwise.
		</p>

		<div class="card dark:divide-vercel-accents-2 mt-3 divide-y divide-slate-100">
			<template v-if="connection">
				<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
					<div class="min-w-60 flex-1">
						<p class="text-sm font-medium text-slate-900 dark:text-white">
							Paired with opencode {{ connection.version }}
						</p>
						<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
							{{ connection.url }} · {{ connection.model }}
						</p>
						<p v-if="problem" class="mt-1 text-sm text-amber-700 dark:text-amber-300">
							{{ problem }}
						</p>
					</div>
					<AppButton @click="forget">Disconnect</AppButton>
				</div>
				<SwitchGroup as="div" class="flex items-center justify-between gap-6 px-5 py-4">
					<div class="min-w-60 flex-1">
						<SwitchLabel
							as="p"
							class="text-sm font-medium text-slate-900 dark:text-white"
							passive
						>
							Use it for Smart group
						</SwitchLabel>
						<SwitchDescription
							class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500"
						>
							The titles and addresses of the tabs you group are sent to
							{{ connection.model }} through opencode.
						</SwitchDescription>
					</div>
					<AppSwitch v-model="enabled" />
				</SwitchGroup>
			</template>

			<form v-else class="space-y-3 px-5 py-4" @submit.prevent="connect">
				<div>
					<p class="text-sm font-medium text-slate-900 dark:text-white">
						Pair with opencode
					</p>
					<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
						Run
						<code
							class="dark:bg-vercel-accents-2 rounded bg-slate-100 px-1 py-px font-mono text-xs"
							>opencode pair</code
						>
						in a terminal and paste the link it prints. Links work once, for 5 minutes;
						the pairing lasts 30 days. Once paired, the titles and addresses of the tabs
						you group go to opencode's model.
					</p>
				</div>
				<div class="flex gap-2">
					<input
						v-model="link"
						type="url"
						required
						placeholder="http://127.0.0.1:4096/auth/connect/…"
						aria-label="Pairing link"
						class="field h-8 min-w-0 flex-1"
					/>
					<AppButton intent="primary" type="submit" :disabled="busy || !link.trim()">
						{{ busy ? 'Pairing…' : 'Pair' }}
					</AppButton>
				</div>
				<p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">
					{{ error }}
				</p>
			</form>
		</div>
	</section>
</template>
