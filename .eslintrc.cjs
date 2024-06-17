require('@rushstack/eslint-patch/modern-module-resolution')

/** @type {import("eslint").Linter.Config} */
module.exports = {
	root: true,
	env: {
		node: true,
		webextensions: true,
		'vue/setup-compiler-macros': true,
	},
	parserOptions: {
		ecmaVersion: 'latest',
	},
	extends: [
		'plugin:vue/vue3-recommended',
		'eslint:recommended',
		// '@vue/typescript/recommended',
		'@vue/eslint-config-typescript',
		'@vue/eslint-config-prettier/skip-formatting',
	],
	rules: {
		quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
		semi: ['warn', 'never'],
	},
}
