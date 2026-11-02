<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowTopRightOnSquareIcon, DocumentDuplicateIcon, LinkIcon } from '@heroicons/vue/16/solid'
import { toast } from 'vue-sonner'
import { useSettings } from '@/hooks/useSettings'
import { copyToClipboard, formatUrlAsMarkdown } from '@/utils'
import { getDisplayUrl, pluralize } from '@/lib/format'
import { button } from '@/lib/ui'
import AppButton from '@/components/AppButton.vue'
import AppTextarea from '@/components/forms/AppTextarea.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import TabFavicon from '@/components/TabFavicon.vue'

const textWithUrls = ref('')
const isOpening = ref(false)
const { settings, loadSettings } = useSettings()

// Unique links, without punctuation that trails them in prose ("see https://x.com.")
const parsedUrls = computed(() => {
	const urlRegex = /(https?:\/\/[^\s<>"']+)/g
	const matches = Array.from(textWithUrls.value.matchAll(urlRegex), (m) =>
		m[0].replace(/[).,;:!?\]]+$/, ''),
	)
	return [...new Set(matches)]
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
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
	} finally {
		isOpening.value = false
	}
}

const formatUrl = (url: string) =>
	settings.value.copyLinksInMarkdownFormat ? formatUrlAsMarkdown(url) : url

const copyUrls = () => {
	if (!parsedUrls.value.length) return
	const separator = settings.value.copyLinksInMarkdownFormat ? '\n\n' : '\n'
	copyToClipboard(parsedUrls.value.map(formatUrl).join(separator))
	toast(`Copied ${pluralize(parsedUrls.value.length, 'link')}`)
}

const copyOne = (url: string) => {
	copyToClipboard(formatUrl(url))
	toast('Link copied')
}

const actionClass = button({ intent: 'ghost', size: 'xs', square: true })

onMounted(() => {
	loadSettings()
})
</script>
<template>
	<div class="page-container py-8">
		<PageHeader title="Utilities" description="Small tools for working with links." />

		<section class="card mt-8 overflow-clip">
			<div
				class="dark:border-vercel-accents-2 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4"
			>
				<div class="flex items-center gap-3">
					<span
						class="dark:bg-vercel-accents-2 dark:text-vercel-accents-6 flex size-8 items-center justify-center rounded-md bg-slate-100 text-slate-500"
					>
						<LinkIcon class="size-4" aria-hidden="true" />
					</span>
					<div>
						<h2 class="text-sm font-semibold text-slate-900 dark:text-white">
							Extract links
						</h2>
						<p class="dark:text-vercel-accents-5 text-sm text-slate-500">
							Paste any text and pull out every link in it.
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<AppButton :disabled="!parsedUrls.length" @click="copyUrls">
						<DocumentDuplicateIcon class="size-4" aria-hidden="true" />
						Copy all
					</AppButton>
					<AppButton
						intent="primary"
						:disabled="!parsedUrls.length || isOpening"
						@click="openLinks"
					>
						<ArrowTopRightOnSquareIcon class="size-4" aria-hidden="true" />
						{{
							isOpening
								? 'Opening…'
								: parsedUrls.length
									? `Open ${pluralize(parsedUrls.length, 'link')} in a new window`
									: 'Open in a new window'
						}}
					</AppButton>
				</div>
			</div>

			<div
				class="dark:divide-vercel-accents-2 grid divide-slate-200 lg:grid-cols-2 lg:divide-x"
			>
				<div class="p-5">
					<AppTextarea
						id="input-links"
						v-model="textWithUrls"
						label="Text"
						:autogrow="false"
						name="input_links"
						class="h-80 resize-none font-mono text-xs leading-relaxed"
						placeholder="Check out https://example.com and https://github.com — any text works."
					/>
				</div>
				<div class="flex flex-col p-5">
					<p class="dark:text-vercel-accents-7 mb-1.5 text-sm font-medium text-slate-700">
						{{
							parsedUrls.length
								? pluralize(parsedUrls.length, 'link') + ' found'
								: 'Links'
						}}
					</p>
					<ul
						v-if="parsedUrls.length"
						role="list"
						class="dark:border-vercel-accents-2 dark:divide-vercel-accents-2/60 h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200"
					>
						<li
							v-for="url in parsedUrls"
							:key="url"
							class="group dark:hover:bg-vercel-accents-1 flex h-10 items-center gap-3 pr-1.5 pl-3 hover:bg-slate-50"
						>
							<TabFavicon :url="url" />
							<span
								class="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200"
								:title="url"
							>
								{{ getDisplayUrl(url) }}
							</span>
							<div
								class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
							>
								<button
									type="button"
									:class="actionClass"
									title="Copy link"
									@click="copyOne(url)"
								>
									<DocumentDuplicateIcon class="size-3.5" aria-hidden="true" />
									<span class="sr-only">Copy link</span>
								</button>
								<a
									:href="url"
									target="_blank"
									rel="noreferrer"
									:class="actionClass"
									title="Open in new tab"
								>
									<ArrowTopRightOnSquareIcon
										class="size-3.5"
										aria-hidden="true"
									/>
									<span class="sr-only">Open in new tab</span>
								</a>
							</div>
						</li>
					</ul>
					<div
						v-else
						class="dark:border-vercel-accents-2 flex h-80 items-center justify-center rounded-md border border-dashed border-slate-200"
					>
						<EmptyState
							compact
							:icon="LinkIcon"
							title="No links yet"
							description="Links in the text will show up here."
						/>
					</div>
				</div>
			</div>
		</section>
	</div>
</template>
