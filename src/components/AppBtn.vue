<script setup lang="ts">
import { computed } from 'vue'

const colorClasses = {
  'primary-dark':
    'inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300 shadow-sm ring-0 highlight-white/5 hover:bg-slate-700',
  primary:
    'inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm',
  'round-primary':
    'inline-flex items-center rounded-full bg-slate-100 px-1 py-1 text-xs font-medium text-slate-800 shadow-sm',
  'round-dark-primary':
    'inline-flex items-center rounded-full bg-slate-800 px-1 py-1 text-xs font-medium text-slate-300 shadow-sm ring-0 highlight-white/5 hover:bg-slate-700',
}
type ColorType = keyof typeof colorClasses

interface Props {
  color?: ColorType
}
const { color: propColor = 'primary' } = defineProps<Props>()
const btnClasses = computed(() => {
  return colorClasses[propColor]
})
</script>

<template>
  <button :class="btnClasses" v-bind="$attrs"><slot /></button>
</template>
