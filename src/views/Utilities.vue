<script setup lang="ts">
import AppBtn from '@/components/AppBtn.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import { computed, onMounted, ref } from 'vue'
import { LinkIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import { useSettings } from '@/hooks/useSettings'
import { formatUrlAsMarkdown } from '@/utils'

const textWithUrls = ref('')
const isOpening = ref(false)
const { settings, loadSettings } = useSettings()

const parsedUrls = computed(() => {
	const urlRegex = /(https?:\/\/[^\s]+)/g
	const matches = Array.from(textWithUrls.value.matchAll(urlRegex), (m) => m[0])
	return matches
})

const openLinks = async () => {
	if (parsedUrls.value.length < 1) {
		return
	}
	
	isOpening.value = true
	
	try {
		const createdWindow = await chrome.windows.create({
			url: parsedUrls.value[0],
		})
		if (!createdWindow) return
		
		const openlinks = parsedUrls.value.slice(1)
		for (const url of openlinks) {
			await chrome.tabs.create({
				url: url,
				windowId: createdWindow.id,
			})
			// Small delay to prevent overwhelming the browser
			await new Promise(resolve => setTimeout(resolve, 50))
		}
	} finally {
		isOpening.value = false
	}
}

const copyUrls = async () => {
	if (parsedUrls.value.length > 0) {
		let content: string
		
		if (settings.value.copyLinksInMarkdownFormat) {
			content = parsedUrls.value
				.map(url => formatUrlAsMarkdown(url))
				.join('\n\n')
		} else {
			content = parsedUrls.value.join('\n')
		}
		
		await navigator.clipboard.writeText(content)
	}
}

onMounted(() => {
	loadSettings()
})
</script>
<template>
	<div class="relative">
		<div class="container mx-auto max-w-7xl px-4 py-6 sm:px-2">
			<div class="px-4 sm:px-6 lg:px-8">
				<!-- Header Section -->
				<div class="sm:flex sm:items-center">
					<div class="sm:flex-auto">
						<div class="flex items-center gap-3 mb-2">
							<LinkIcon class="h-6 w-6 text-slate-600 dark:text-vercel-accents-5" />
							<h1 class="text-xl font-semibold text-slate-900 dark:text-white">
								URL Extractor
							</h1>
						</div>
						<p class="mt-2 text-sm text-slate-700 dark:text-vercel-accents-5">
							Paste any text containing URLs and extract them automatically. Open all links in a new window or copy them to your clipboard.
						</p>
					</div>
					<div class="mt-4 space-x-2 sm:ml-16 sm:mt-0 sm:flex-none">
						<AppBtn 
							v-if="parsedUrls.length > 0"
							color="round-primary" 
							@click="copyUrls"
						>
							<DocumentDuplicateIcon class="size-4" />
						</AppBtn>
						<AppBtn 
							color="round-primary" 
							@click="openLinks"
							:disabled="parsedUrls.length === 0 || isOpening"
						>
							<LinkIcon class="size-4" />
						</AppBtn>
					</div>
				</div>

				<!-- Stats Bar -->
				<div class="mt-6 flex items-center gap-4 text-sm text-slate-700 dark:text-vercel-accents-5">
					<div>
						<span class="font-medium text-slate-900 dark:text-white">
							{{ parsedUrls.length }}
						</span>
						{{ parsedUrls.length === 1 ? 'URL' : 'URLs' }} found
					</div>
					<div v-if="parsedUrls.length > 0" class="h-4 w-px bg-slate-300 dark:bg-vercel-accents-2"></div>
					<div v-if="parsedUrls.length > 0">
						{{ isOpening ? 'Opening links...' : 'Ready to open' }}
					</div>
				</div>

				<!-- Main Content Grid -->
				<div class="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
					<!-- Input Section -->
					<div class="space-y-4">
						<h2 class="text-lg font-medium text-slate-900 dark:text-white">
							Input Text
						</h2>
						<div class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:border dark:border-vercel-accents-2 md:rounded-lg">
							<div class="bg-white dark:bg-black px-4 py-5 sm:p-6">
								<AppTextarea
									id="input-links"
									v-model="textWithUrls"
									label="Paste your text here"
									placeholder="Paste any text containing URLs here. For example:
Check out https://example.com and https://github.com
Visit our site at https://mysite.com for more info!"
									rows="18"
									name="input_links"
									class="resize-none"
								/>
							</div>
						</div>
					</div>

					<!-- Output Section -->
					<div class="space-y-4">
						<h2 class="text-lg font-medium text-slate-900 dark:text-white">
							Extracted URLs
						</h2>
						<div class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:border dark:border-vercel-accents-2 md:rounded-lg">
							<div class="bg-white dark:bg-black px-4 py-5 sm:p-6">
								<AppTextarea
									id="output-links"
									:model-value="parsedUrls.length > 0 ? parsedUrls.join('\n\n') : 'No URLs found yet. Paste some text with URLs in the input area.'"
									label="Found URLs"
									readonly
									rows="18"
									name="output_links"
									class="resize-none"
									:class="parsedUrls.length === 0 ? 'text-slate-500 dark:text-vercel-accents-4 italic' : ''"
								/>
							</div>
						</div>
					</div>
				</div>

				<!-- Help Section -->
				<div class="mt-8 rounded-lg bg-slate-50 dark:bg-vercel-accents-1 p-4">
					<h3 class="text-sm font-medium text-slate-900 dark:text-white mb-2">
						How to use:
					</h3>
					<ul class="text-sm text-slate-700 dark:text-vercel-accents-5 space-y-1">
						<li>• Paste any text containing URLs in the input area</li>
						<li>• URLs will be automatically detected and extracted</li>
						<li>• Click the link icon to open all URLs in a new browser window</li>
						<li>• Use the copy icon to copy the extracted URLs to your clipboard</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</template>
