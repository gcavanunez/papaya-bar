module.exports = {
	plugins: {
		'postcss-nested': {},
		'postcss-focus-visible': {
			replaceWith: '[data-focus-visible-added]',
		},
		'@tailwindcss/postcss': {},
	},
}
