import { createApp } from 'vue'
import { router } from './router'
import 'focus-visible'
import './index.css'
import App from './App.vue'
import 'v-calendar/dist/style.css'

import VCalendar from 'v-calendar'

// Setup plugin for defaults or `$screens` (optional)
// const myPlugin = {
// 	install(app: AppVue) {
// 		app.config.globalProperties.$translate = (key: any) => {
// 			// retrieve a nested property in `options`
// 			// using `key` as the path
// 			// console.log(key)
// 			// return key.split('.').reduce((o, i) => {
// 			//   if (o) return o[i]
// 			// }, options)
// 		}
// 	},
// }
createApp(App)
	.use(router)
	.use(VCalendar, {})
	// .use(myPlugin, {
	// 	/* optional options */
	// })
	.directive('autogrow', {
		created(el) {
			el.addEventListener('input', () => {
				el.style.height = 'auto'
				el.style.height = el.scrollHeight + 'px'
			})
		},
		mounted(el) {
			el.style.height = 'auto'
			el.style.height = el.scrollHeight + 'px'
		},
	})
	.mount('#app')
