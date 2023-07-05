module.exports = {
	plugins: {
		tailwindcss: {},
		'postcss-nested': {},
		'postcss-focus-visible': {
			replaceWith: '[data-focus-visible-added]',
		},
		autoprefixer: {},
	},
}
