import { ref, onMounted, watchEffect } from 'vue'
import { createPopper, Options } from '@popperjs/core'

export const usePopper = (options: Options) => {
  let reference = ref<HTMLElement | null>(null)
  let popper = ref<HTMLElement | null>(null)

  onMounted(() => {
    watchEffect((onInvalidate) => {
      if (!popper.value) return
      if (!reference.value) return

      let popperEl = popper.value || popper.value
      let referenceEl = reference.value || reference.value

      if (!(referenceEl instanceof HTMLElement)) return
      if (!(popperEl instanceof HTMLElement)) return

      let { destroy } = createPopper(referenceEl, popperEl, options)

      onInvalidate(destroy)
    })
  })

  return [reference, popper]
}
