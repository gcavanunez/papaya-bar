import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { crx, ManifestV3Export } from '@crxjs/vite-plugin'

import manifestData from './manifest.json' assert { type: 'json' }
const manifest = manifestData as ManifestV3Export

import { execSync } from 'child_process'
let lastCommitHash = ''
try {
	lastCommitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch (e) {
	console.error(e)
}

export default defineConfig({
	define: {
		__COMMIT_HASH__: JSON.stringify(lastCommitHash),
	},

	plugins: [tailwindcss(), , vue(), crx({ manifest })],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		cors: {
			origin: [/chrome-extension:\/\//],
		},
	},
})
