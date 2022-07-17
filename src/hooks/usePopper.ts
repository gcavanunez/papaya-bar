import { ref, onMounted, watchEffect, Component } from 'vue'
import { createPopper, Options } from '@popperjs/core'

// Currently using Popper with a bunch of data makes it feel somewhat janky aside from
// types for accessing el
// explore Float UI
// https://stackblitz.com/edit/github-9s97hz?file=src%2FApp.vue
export const usePopper = (options: Options) => {
  // Not happy anys
  let reference = ref<any | null>(null)
  // ought to be singleton popper any
  let popper = ref<any | null>(null)

  onMounted(() => {
    watchEffect((onInvalidate) => {
      if (!popper.value) return
      if (!reference.value) return

      let popperEl = popper.value.el || popper.value
      let referenceEl = reference.value.el || reference.value

      if (!(referenceEl instanceof HTMLElement)) return
      if (!(popperEl instanceof HTMLElement)) return

      let { destroy } = createPopper(referenceEl, popperEl, options)
      onInvalidate(destroy)
    })
  })

  return [reference, popper]
}
