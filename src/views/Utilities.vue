<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import { computed, ref } from 'vue'
const textWithUrls = ref('')
// const parsedUrls = ref<string[]>([])
const parsedUrls = computed(() => {
	const urlRegex = /(https?:\/\/[^\s]+)/g
	const matches = Array.from(textWithUrls.value.matchAll(urlRegex), (m) => m[0])
	return matches
})
const openLinks = async () => {
	if (parsedUrls.value.length < 1) {
		return
	}
	const createdWindow = await chrome.windows.create({
		url: parsedUrls.value[0],
	})
	if (!createdWindow) return
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
		<div class="container mx-auto max-w-5xl px-4 py-6 sm:px-2">
			<div class="flex w-full justify-end">
				<AppBtn color="white" @click="openLinks">Open all links</AppBtn>
			</div>
			<div class="mt-6 grid grid-cols-2 gap-4">
				<div>
					<div
						class="ring-opacity-5 shadow-sm ring-1 ring-black sm:overflow-hidden sm:rounded-lg"
					>
						<div class="space-y-6 bg-white px-4 py-5 sm:p-6 dark:bg-black">
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
					<div
						class="ring-opacity-5 shadow-sm ring-1 ring-black sm:overflow-hidden sm:rounded-lg"
					>
						<div class="space-y-6 bg-white px-4 py-5 sm:p-6 dark:bg-black">
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
