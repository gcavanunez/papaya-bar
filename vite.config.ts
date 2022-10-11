import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const childProcess = require('child_process')
let lastCommitHash = ''
try {
	lastCommitHash = childProcess.execSync('git rev-parse --short HEAD').toString().trim()
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
	],

	resolve: {
		alias: {
			'@': resolve(__dirname, 'src'),
		},
	},
})
