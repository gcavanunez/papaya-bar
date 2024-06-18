<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import { computed, ref } from 'vue'
const textWithUrls = ref('')
// const parsedUrls = ref<string[]>([])
const parsedUrls = computed(() => {
	let urlRegex = /(https?:\/\/[^\s]+)/g
	let matches = Array.from(textWithUrls.value.matchAll(urlRegex), (m) => m[0])
	return matches
})
const openLinks = async () => {
	if (parsedUrls.value.length < 1) {
		return
	}
	const createdWindow = await chrome.windows.create({
		url: parsedUrls.value[0],
	})
	const openlinks = parsedUrls.value.slice(1)
	openlinks.forEach((row) => {
		chrome.tabs.create({
			url: row,
			windowId: createdWindow.id,
		})
	})
}
</script>
<template>
	<div class="relative">
		<div class="container mx-auto max-w-5xl py-6 px-4 sm:px-2">
			<div class="flex w-full justify-end">
				<AppBtn color="white" @click="openLinks">Open all links</AppBtn>
			</div>
			<div class="mt-6 grid grid-cols-2 gap-4">
				<div>
					<div class="shadow-sm ring-1 ring-black ring-opacity-5 sm:overflow-hidden sm:rounded-lg">
						<div class="space-y-6 bg-white py-5 px-4 dark:bg-black sm:p-6">
							<div>
								<AppTextarea
									id="input-links"
									v-model="textWithUrls"
									label="Input your text"
									rows="15"
									name="input_links"
								/>
							</div>
						</div>
					</div>
				</div>
				<div>
					<div class="shadow-sm ring-1 ring-black ring-opacity-5 sm:overflow-hidden sm:rounded-lg">
						<div class="space-y-6 bg-white py-5 px-4 dark:bg-black sm:p-6">
							<div>
								<AppTextarea
									id="output-links"
									:model-value="parsedUrls.join('\n\n')"
									label="Links matched"
									readonly
									rows="15"
									name="output_links"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
