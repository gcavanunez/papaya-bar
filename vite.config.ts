import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { crx } from '@crxjs/vite-plugin'

//@ts-ignore
import manifest from './manifest.json' // Node 14 & 16

import { execSync } from 'child_process'
// const childProcess = require('child_process')
let lastCommitHash = ''
try {
	lastCommitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch (e) {
	console.error(e)
}
console.log({ lastCommitHash })

// https://vitejs.dev/config/
export default defineConfig({
	define: {
		__COMMIT_HASH__: JSON.stringify(lastCommitHash),
	},
	plugins: [
		vue({
			reactivityTransform: true,
		}),
		crx({ manifest }),
	],

	resolve: {
		alias: {
			'@': resolve(__dirname, 'src'),
		},
	},
})
