import { createApp } from 'vue'
import { router } from './router'
import 'focus-visible'
import './index.css'
import App from './App.vue'
import 'v-calendar/dist/style.css'
import { MotionPlugin } from '@vueuse/motion'

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
const app = createApp(App)

app.use(router)
app.use(VCalendar, {})
app.use(MotionPlugin)
// app.use(myPlugin, {
// 	/* optional options */
// })
app.directive('autogrow', {
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
app.mount('#app')
