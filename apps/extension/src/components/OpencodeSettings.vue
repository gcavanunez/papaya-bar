<script setup lang="ts">
/**
 * Settings → Smart group: pair with an opencode server, and pick which of its models
 * Smart group uses (opencode's default model unless one is picked).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { SwitchDescription, SwitchGroup, SwitchLabel } from '@headlessui/vue'
import { toast } from 'vue-sonner'
import {
	checkConnection,
	disconnect,
	listModels,
	loadConnection,
	modelDetails,
	pair,
	sameModel,
	updateConnection,
	type OpencodeConnection,
	type OpencodeModel,
} from '@/lib/opencode'
import AppButton from '@/components/AppButton.vue'
import AppSwitch from '@/components/forms/AppSwitch.vue'
import SearchInput from '@/components/forms/SearchInput.vue'

const connection = ref<OpencodeConnection | null>(null)
const enabled = ref(false)
const link = ref('')
const busy = ref(false)
const error = ref('')
const problem = ref('')

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------- The model ----------

/** opencode's default model, used when none is picked */
const defaultModel = ref<OpencodeModel | null>(null)
/** opencode's models, loaded when they're needed */
const models = ref<OpencodeModel[] | null>(null)
const modelsError = ref('')
const picking = ref(false)
const query = ref('')

async function loadModels(): Promise<OpencodeModel[] | null> {
	if (models.value || !connection.value) return models.value
	modelsError.value = ''
	try {
		models.value = await listModels(connection.value)
	} catch (e) {
		modelsError.value = errorText(e)
	}
	return models.value
}

/** The model Smart group uses now, with its details when they're known */
const currentModel = computed<OpencodeModel | null>(() => {
	const choice = connection.value?.choice
	if (!choice) return defaultModel.value
	return models.value?.find((m) => sameModel(m, choice)) ?? null
})

const sections = computed(() => {
	const q = query.value.trim().toLowerCase()
	const byProvider = new Map<string, OpencodeModel[]>()
	for (const model of models.value ?? []) {
		const text = `${model.name} ${model.id} ${model.provider ?? ''}`.toLowerCase()
		if (q && !text.includes(q)) continue
		const key = model.provider ?? model.providerID
		byProvider.set(key, [...(byProvider.get(key) ?? []), model])
	}
	return [...byProvider].map(([provider, list]) => ({ provider, models: list }))
})

const optionClass =
	'dark:hover:bg-vercel-accents-1 flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-50'

const tokens = (n: number) =>
	n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`
const dollars = (n: number) => `$${n < 1 ? n.toFixed(2) : +n.toFixed(2)}`

/** "Anthropic · Reads up to 1M tokens · $0.10 in, $0.50 out per million tokens" */
function details(model: OpencodeModel, withProvider = true): string {
	const parts: string[] = []
	if (withProvider && model.provider) parts.push(model.provider)
	if (model.limits.context) parts.push(`Reads up to ${tokens(model.limits.context)} tokens`)
	if (model.price) {
		parts.push(
			model.price.input || model.price.output
				? `${dollars(model.price.input)} in, ${dollars(model.price.output)} out per million tokens`
				: 'Free, with usage limits',
		)
	}
	return parts.join(' · ')
}

async function togglePicker() {
	picking.value = !picking.value
	query.value = ''
	if (picking.value) await loadModels()
}

async function choose(model: OpencodeModel | null) {
	if (!connection.value) return
	const fallback = defaultModel.value
	const changes: Partial<OpencodeConnection> = model
		? { choice: { providerID: model.providerID, id: model.id }, ...modelDetails(model) }
		: { choice: undefined, ...(fallback ? modelDetails(fallback) : {}) }
	await updateConnection(changes)
	connection.value = { ...connection.value, ...changes }
	picking.value = false
	problem.value = ''
	toast(`Smart group now uses ${connection.value.model}`)
}

async function load() {
	connection.value = await loadConnection()
	enabled.value = !!connection.value?.enabled
	problem.value = ''
	if (!connection.value) return
	try {
		// Refresh the version and model, and notice an expired pairing early
		const { version, defaultModel: fallback } = await checkConnection(connection.value)
		defaultModel.value = fallback
		const choice = connection.value.choice
		let changes: Partial<OpencodeConnection> = { version, ...modelDetails(fallback) }
		if (choice) {
			const chosen = (await loadModels())?.find((m) => sameModel(m, choice))
			changes = chosen ? { version, ...modelDetails(chosen) } : { version }
			if (!chosen && models.value) {
				problem.value = `opencode no longer lists ${connection.value.model}. Pick another model.`
			}
		}
		await updateConnection(changes)
		connection.value = { ...connection.value, ...changes }
	} catch (e) {
		problem.value = errorText(e)
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
		toast(`Paired with opencode. Smart group now uses ${connection.value.model}.`, {
			description: 'You can pick another of its models here.',
		})
		await load()
	} catch (e) {
		error.value = errorText(e)
	} finally {
		busy.value = false
	}
}

async function forget() {
	await disconnect()
	connection.value = null
	enabled.value = false
	models.value = null
	defaultModel.value = null
	picking.value = false
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
			Group tabs by topic with a model from your opencode server. Without it, Smart group uses
			Chrome's on-device model when it's ready, and groups by site otherwise.
		</p>

		<div class="card dark:divide-vercel-accents-2 mt-3 divide-y divide-slate-100">
			<template v-if="connection">
				<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
					<div class="min-w-60 flex-1">
						<p class="text-sm font-medium text-slate-900 dark:text-white">
							Paired with opencode {{ connection.version }}
						</p>
						<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
							{{ connection.url }}
						</p>
						<p v-if="problem" class="mt-1 text-sm text-amber-700 dark:text-amber-300">
							{{ problem }}
						</p>
					</div>
					<AppButton @click="forget">Disconnect</AppButton>
				</div>

				<div class="px-5 py-4">
					<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
						<div class="min-w-60 flex-1">
							<p class="text-sm font-medium text-slate-900 dark:text-white">
								Model: {{ connection.model }}
							</p>
							<p class="dark:text-vercel-accents-5 mt-0.5 text-sm text-slate-500">
								<template v-if="!connection.choice">
									opencode's default, so it follows opencode's settings.
								</template>
								{{ currentModel ? details(currentModel) : '' }}
							</p>
						</div>
						<AppButton :aria-expanded="picking" @click="togglePicker">
							{{ picking ? 'Done' : 'Change' }}
						</AppButton>
					</div>

					<div v-if="picking" class="mt-3">
						<SearchInput
							v-model="query"
							size="sm"
							placeholder="Search models"
							aria-label="Search models"
						/>
						<p
							v-if="modelsError"
							class="mt-2 text-sm text-red-600 dark:text-red-400"
							role="alert"
						>
							{{ modelsError }}
						</p>
						<p
							v-else-if="!models"
							class="dark:text-vercel-accents-5 mt-2 text-sm text-slate-500"
						>
							Loading opencode's models…
						</p>
						<div
							v-else
							role="radiogroup"
							aria-label="Model for Smart group"
							class="dark:border-vercel-accents-2 mt-2 max-h-80 overflow-y-auto rounded-md border border-slate-200"
						>
							<label v-if="!query" :class="optionClass">
								<input
									type="radio"
									name="opencode-model"
									class="mt-1"
									:checked="!connection.choice"
									@change="choose(null)"
								/>
								<span class="min-w-0">
									<span class="block text-sm text-slate-900 dark:text-white">
										opencode's default
									</span>
									<span
										class="dark:text-vercel-accents-5 block text-xs text-slate-500"
									>
										Now {{ defaultModel?.name ?? 'unknown' }}; follows
										opencode's settings
									</span>
								</span>
							</label>
							<template v-for="section in sections" :key="section.provider">
								<p
									class="dark:bg-vercel-accents-1 dark:text-vercel-accents-5 sticky top-0 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500"
								>
									{{ section.provider }}
								</p>
								<label
									v-for="model in section.models"
									:key="`${model.providerID}/${model.id}`"
									:class="optionClass"
								>
									<input
										type="radio"
										name="opencode-model"
										class="mt-1"
										:checked="sameModel(model, connection.choice)"
										@change="choose(model)"
									/>
									<span class="min-w-0">
										<span class="block text-sm text-slate-900 dark:text-white">
											{{ model.name }}
											<!-- The same model can come from several providers -->
											<span class="sr-only">({{ section.provider }})</span>
										</span>
										<span
											class="dark:text-vercel-accents-5 block text-xs text-slate-500"
										>
											{{ details(model, false) }}
										</span>
									</span>
								</label>
							</template>
							<p
								v-if="!sections.length"
								class="dark:text-vercel-accents-5 px-3 py-2 text-sm text-slate-500"
							>
								No models match “{{ query }}”
							</p>
						</div>
					</div>
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
							The titles and sites of the tabs you group are sent to
							{{ connection.model }} through opencode (the whole address for a tab
							with no title).
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
						the pairing lasts 30 days. Use the
						<code
							class="dark:bg-vercel-accents-2 rounded bg-slate-100 px-1 py-px font-mono text-xs"
							>127.0.0.1</code
						>
						link when opencode runs on this computer. Once paired, the titles and sites
						of the tabs you group go to the opencode model you pick.
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
