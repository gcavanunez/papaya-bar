# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Type Support For `.vue` Imports in TS

Since TypeScript cannot handle type information for `.vue` imports, they are shimmed to be a generic Vue component type by default. In most cases this is fine if you don't really care about component prop types outside of templates. However, if you wish to get actual prop types in `.vue` imports (for example to get props validation when using manual `h(...)` calls), you can enable Volar's Take Over mode by following these steps:

1. Run `Extensions: Show Built-in Extensions` from VS Code's command palette, look for `TypeScript and JavaScript Language Features`, then right click and select `Disable (Workspace)`. By default, Take Over mode will enable itself if the default TypeScript extension is disabled.
2. Reload the VS Code window by running `Developer: Reload Window` from the command palette.

You can learn more about Take Over mode [here](https://github.com/johnsoncodehk/volar/discussions/471).

# Todo's

- [x] (ish) Get dropdown to use Popper to display dropdown accordingly 
- [x] Close duplicate tabs
- [x] Change bg hooked to the bottom

- [ ] Explore better dx via Vite -> Chrome 
- [ ] Persist searches/as filters -> to chrome sync
- [ ] Dark mode toggle -> to chrome sync
- [ ] Check Responsive story
- [ ] animations when closing tabs
- [ ] Check error removing a row focus passing to new item
- [ ] Selected tabs persisting even though no longer exist
- [ ] Optimize events rather than re-init
- [ ] validate instances where stableId just does not make sense (undefined state)
