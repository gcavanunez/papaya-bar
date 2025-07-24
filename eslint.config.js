import prettier from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'

import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
	vue.configs['flat/essential'],
	vueTsConfigs.recommended,
	{
		ignores: ['node_modules', 'public', 'dist', 'tailwind.config.js', 'tailwind.config.cjs'],
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
