module.exports = {
	root: true,
	env: {
		node: true,
		'vue/setup-compiler-macros': true,
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
