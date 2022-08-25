// import Vue from 'vue'
//

export {}

// import { ComponentCustomProperties } fr Dom 'vue'
// https://github.com/johnsoncodehk/volar/issues/807

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $screens: VCalendar
    $translate: any
  }
}

// declare module 'vue' {
//   interface ComponentCustomProperties {
//     $screens: any
//     $translate: any // replace it with the right type
//   }
// }
