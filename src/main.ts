import { createApp } from 'vue'
import { router } from './router'
import 'focus-visible'
import './index.css'
import App from './App.vue'

createApp(App).use(router).mount('#app')
