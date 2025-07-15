// require('@rushstack/eslint-patch/modern-module-resolution')

// /** @type {import("eslint").Linter.Config} */
// module.exports = {
// 	root: true,
// 	env: {
// 		node: true,
// 		webextensions: true,
// 	},
// 	parserOptions: {
// 		ecmaVersion: 'latest',
// 	},
// 	extends: [
// 		'plugin:vue/vue3-recommended',
// 		'eslint:recommended',
// 		// '@vue/typescript/recommended',
// 		'@vue/eslint-config-typescript',
// 		'@vue/eslint-config-prettier/skip-formatting',
// 	],
// 	rules: {
// 		quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
// 		semi: ['warn', 'never'],
// 	},
// }

import prettier from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'

import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
	vue.configs['flat/essential'],
	vueTsConfigs.recommended,
	{
		ignores: ['node_modules', 'public', 'tailwind.config.js'],
	},
	{
		rules: {
			'vue/multi-word-component-names': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
		},
	},
	prettier,
)
