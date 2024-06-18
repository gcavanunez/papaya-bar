import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'

//@ts-ignore
import manifest from './manifest.json' // Node 14 & 16

import { execSync } from 'child_process'
let lastCommitHash = ''
try {
	lastCommitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch (e) {
	console.error(e)
}
console.log({ lastCommitHash })

export default defineConfig({
	define: {
		__COMMIT_HASH__: JSON.stringify(lastCommitHash),
	},
	plugins: [vue(), crx({ manifest })],

	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
})
