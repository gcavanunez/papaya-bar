const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
updateMode()
function updateMode() {
	const isSystemDarkMode = darkModeMediaQuery.matches
	const isDarkMode = window.localStorage.getItem('vueuse-color-scheme') === 'dark'
	const isSystem = window.localStorage.getItem('vueuse-color-scheme') === 'auto'
	const settingExists = 'vueuse-color-scheme' in window.localStorage
	const apply = isDarkMode || (!settingExists && isSystemDarkMode) || (isSystem && isSystemDarkMode)
	console.log('isDark', apply)
	if (apply) {
		document.documentElement.classList.add('dark')
	}
}
