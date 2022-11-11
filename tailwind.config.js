const svgToDataUri = require('mini-svg-data-uri')
const { default: flattenColorPalette } = require('tailwindcss/lib/util/flattenColorPalette')

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// https://vercel.com/design/color#highlight
				vercel: {
					'accents-8': '#fafafa',
					'accents-7': '#eaeaea',
					'accents-6': '#999',
					'accents-5': '#888',
					'accents-4': '#666',
					'accents-3': '#444',
					'accents-2': '#333',
					'accents-1': '#111',
				},
				highlight: {
					yellow: '#FFF500',
					pink: '#FF0080',
				},
				papaya: {
					500: '#FFD96E',
					900: '#FF5D26',
				},
			},
		},
	},
	plugins: [
		require('@tailwindcss/forms'),
		function ({ matchUtilities, theme }) {
			matchUtilities(
				{
					'bg-grid': (value) => ({
						backgroundImage: `url("${svgToDataUri(
							`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="${value}"><path d="M0 .5H31.5V32"/></svg>`
						)}")`,
					}),
				},
				{
					values: flattenColorPalette(theme('backgroundColor')),
					type: 'color',
				}
			)

			matchUtilities(
				{
					highlight: (value) => ({ boxShadow: `inset 0 1px 0 0 ${value}` }),
				},
				{
					values: flattenColorPalette(theme('backgroundColor')),
					type: 'color',
				}
			)
		},
	],
}
