<script setup lang="ts">
import { sessionDate, sessionTitle, useSessionsData } from '@/hooks/useSessionsData'
import { computed, reactive, ref, watch } from 'vue'
import { format, formatDistanceToNowStrict, isValid } from 'date-fns'
import {
	ArrowTopRightOnSquareIcon,
	BookmarkIcon,
	ChevronRightIcon,
	PencilIcon,
} from '@heroicons/vue/16/solid'
import TabManager from '@/components/TabManager.vue'
import { HistoryMap, LookUpTab } from '@/types'
import { getTabHistory } from '@/helpers'
import { useChromeWindowsMap } from '@/hooks/useChromeWindowsMap'
import { pluralize } from '@/lib/format'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import AppInput from '@/components/forms/AppInput.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'

const { findByUid, saveByUid, openAll } = useSessionsData()
type Props = {
	uid: string
}
const props = defineProps<Props>()
// Saved sessions load asynchronously from chrome.storage, so everything derives from this
const session = computed(() => findByUid(props.uid))

const loadedTabsState = computed(() => session.value?.tabs ?? [])
const loadedGroups = computed(() => session.value?.groups ?? [])
const loadedTabHistory = ref<HistoryMap>(new Map())
const lookUpTab = ref<LookUpTab>({})
const windowsMap = useChromeWindowsMap({ loadedTabs: loadedTabsState })

const savedAt = computed(() => sessionDate(props.uid))
const meta = computed(() => {
	const parts = [pluralize(session.value?.tabs.length ?? 0, 'tab')]
	if (isValid(savedAt.value)) {
		parts.push(`saved ${formatDistanceToNowStrict(savedAt.value, { addSuffix: true })}`)
	}
	return parts.join(' · ')
})

const data = reactive({
	title: '',
	description: '',
})
watch(
	() => session.value?.tabs,
	async (tabs) => {
		if (!tabs) return
		const { loadedTabHistory: loadedTabHistoryValues, lookUpTab: lookUpTabValues } =
			await getTabHistory(tabs)
		loadedTabHistory.value = loadedTabHistoryValues
		lookUpTab.value = lookUpTabValues
	},
	{ immediate: true },
)
const openEdit = ref(false)
const toggleEdit = () => {
	data.title = session.value?.title ?? ''
	data.description = session.value?.description ?? ''
	openEdit.value = true
}
const updateSession = () => {
	saveByUid(props.uid, { title: data.title, description: data.description })
	openEdit.value = false
}
</script>
<template>
	<div v-if="session" class="flex flex-1 flex-col">
		<div class="page-container pt-8 pb-2">
			<PageHeader :title="sessionTitle(session)">
				<template #breadcrumb>
					<router-link
						:to="{ name: 'sessions' }"
						class="hover:text-slate-900 dark:hover:text-white"
					>
						Sessions
					</router-link>
					<ChevronRightIcon class="size-3.5 opacity-60" aria-hidden="true" />
					<span :title="isValid(savedAt) ? format(savedAt, 'PPpp') : uid">
						{{ isValid(savedAt) ? format(savedAt, 'MMM d, yyyy · h:mm a') : uid }}
					</span>
				</template>
				<template #description>
					{{ meta }}
					<span v-if="session.description" class="mt-1 block">
						{{ session.description }}
					</span>
				</template>
				<template #actions>
					<AppButton @click="toggleEdit">
						<PencilIcon class="size-3.5" aria-hidden="true" />
						Edit
					</AppButton>
					<AppButton intent="primary" @click="openAll(session)">
						<ArrowTopRightOnSquareIcon class="size-3.5" aria-hidden="true" />
						Open all
					</AppButton>
				</template>
			</PageHeader>
		</div>

		<AppModal v-model="openEdit" title="Edit session">
			<form class="space-y-4" @submit.prevent="updateSession">
				<AppInput
					id="sesh-title"
					v-model="data.title"
					type="text"
					label="Title"
					:placeholder="sessionTitle({ title: '', tabs: session.tabs })"
				/>
				<AppTextarea
					id="sesh-description"
					v-model="data.description"
					label="Notes"
					placeholder="What were you working on?"
					rows="3"
					name="description"
				/>
				<div class="flex justify-end gap-2 pt-1">
					<AppButton @click="openEdit = false">Cancel</AppButton>
					<AppButton intent="primary" type="submit">Save changes</AppButton>
				</div>
			</form>
		</AppModal>

		<TabManager
			:loaded-tabs="loadedTabsState"
			:loaded-groups="loadedGroups"
			:loaded-tab-history="loadedTabHistory"
			:look-up-tab="lookUpTab"
			:windows-map="windowsMap"
		/>
	</div>
	<div v-else class="page-container py-8">
		<div class="card">
			<EmptyState
				:icon="BookmarkIcon"
				title="Session not found"
				description="It may have been deleted, or it hasn't finished loading yet."
			>
				<template #actions>
					<router-link :to="{ name: 'sessions' }" :class="button({ size: 'sm' })">
						Back to sessions
					</router-link>
				</template>
			</EmptyState>
		</div>
	</div>
</template>
