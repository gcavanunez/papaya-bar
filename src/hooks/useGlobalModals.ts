import { Tab } from '@/types'
import { ref } from 'vue'

type GroupFormMode = 'create' | 'edit'

const groupModalToggle = ref(false)

const groupModalForm = ref<{
	/**
	 * @see chrome.tabGroups.UpdateProperties
	 */
	collapsed?: boolean

	color: chrome.tabGroups.ColorEnum

	title: string
}>({ color: 'blue', title: '' })

const mode = ref<GroupFormMode>('create')
const editingGroupId = ref<number>(0)
const groupSelection = ref<Tab[]>([])

const groupColors: {
	value: chrome.tabGroups.ColorEnum
	hex: string
	selectedColor: string
	bgColor: string
}[] = [
	{ bgColor: 'bg-[#DADCE0]', selectedColor: 'ring-[#DADCE0]', hex: '#DADCE0', value: 'grey' },
	{ bgColor: 'bg-[#93B3F2]', selectedColor: 'ring-[#93B3F2]', hex: '#93B3F2', value: 'blue' },
	{ bgColor: 'bg-[#E49086]', selectedColor: 'ring-[#E49086]', hex: '#E49086', value: 'red' },
	{ bgColor: 'bg-[#F7D775]', selectedColor: 'ring-[#F7D775]', hex: '#F7D775', value: 'yellow' },
	{ bgColor: 'bg-[#91C799]', selectedColor: 'ring-[#91C799]', hex: '#91C799', value: 'green' },
	{ bgColor: 'bg-[#F091C8]', selectedColor: 'ring-[#F091C8]', hex: '#F091C8', value: 'pink' },
	{ bgColor: 'bg-[#BC8CF2]', selectedColor: 'ring-[#BC8CF2]', hex: '#BC8CF2', value: 'purple' },
	{ bgColor: 'bg-[#90D7E9]', selectedColor: 'ring-[#90D7E9]', hex: '#90D7E9', value: 'cyan' },
	{ bgColor: 'bg-[#F0B07A]', selectedColor: 'ring-[#F0B07A]', hex: '#F0B07A', value: 'orange' },
]

export const useGlobalModals = () => {
	const createGroup = async ({
		tabs,
		form,
	}: {
		tabs: Tab[]
		form: chrome.tabGroups.UpdateProperties
	}) => {
		let ids: number[] = []
		for (const tab of tabs) {
			if (tab.id) {
				ids.push(tab.id)
			}
		}
		const groupId = await chrome.tabs.group({ tabIds: ids })
		return chrome.tabGroups.update(groupId, { ...form, collapsed: true })
	}

	const onGroupFormSummit = async () => {
		if (mode.value === 'create') {
			await createGroup({ tabs: groupSelection.value, form: groupModalForm.value })
		} else {
			chrome.tabGroups.update(editingGroupId.value, { ...groupModalForm.value, collapsed: true })
			editingGroupId.value = 0
		}
		groupModalToggle.value = false
	}
	const onEditGroup = async ({ tabs }: { tabs: Tab[] }) => {
		const groupId = tabs[0].groupId
		if (groupId) {
			editingGroupId.value = groupId
			const groupData = await chrome.tabGroups.get(groupId)
			const editState = { color: groupData.color, title: '' }
			if (groupData.title) {
				editState['title'] = groupData.title
			}
			groupModalForm.value = editState
			mode.value = 'edit'
			groupModalToggle.value = true
		}
	}
	const onCreateNewGroup = ({ tabs }: { tabs: Tab[] }) => {
		resetForm()
		editingGroupId.value = 0
		mode.value = 'create'
		groupSelection.value = tabs
		groupModalToggle.value = true
	}
	const resetForm = () => {
		groupModalForm.value = { color: 'blue', title: '' }
	}
	// watch route change to reset globals to initial state?
	return {
		createGroup,
		onGroupFormSummit,
		onEditGroup,
		onCreateNewGroup,
		mode,
		groupModalForm,
		editingGroupId,
		groupSelection,
		groupModalToggle,
		groupColors,
	}
}
