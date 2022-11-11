<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
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
					<div class="shadow sm:overflow-hidden sm:rounded-md">
						<div class="space-y-6 bg-white px-4 py-5 sm:p-6">
							<div>
								<label for="about" class="block text-sm font-medium text-slate-700">
									Input your text
								</label>
								<div class="mt-1">
									<textarea
										id="about"
										name="code"
										rows="15"
										v-model="textWithUrls"
										class="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
										placeholder="<div ..."
									></textarea>
								</div>
							</div>
						</div>
					</div>
				</div>
				<div>
					<div class="shadow sm:overflow-hidden sm:rounded-md">
						<div class="space-y-6 bg-white px-4 py-5 sm:p-6">
							<div>
								<label for="about" class="block text-sm font-medium text-slate-700">
									Links matched
								</label>
								<div class="mt-1">
									<textarea
										readonly
										rows="15"
										class="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus-visible:border-blue-500 focus-visible:ring-blue-500 sm:text-sm"
										>{{ parsedUrls.join('\n\n') }}</textarea
									>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
