# sld-editor
Single Line Diagram Editor

# Frontend locale
UI strings are picked at build time (no runtime language switcher). Each dev/build
script runs `scripts/generate-active-locale.mjs <locale>` first, which (re)writes
`src/i18n/active.ts` to re-export that locale's dictionary — the app itself imports
only that one file, so an unselected locale's strings are never even part of the
bundle. Adding a new language is just: add `src/i18n/<locale>.ts` (typed against
`en.ts`'s own keys, like `ru.ts`) and one `dev:<locale>`/`build:<locale>` script pair.

```
npm run dev         # dev server, English (default)
npm run dev:en      # dev server, English
npm run dev:ru      # dev server, Russian

npm run build       # production build, English (default) -> dist/
npm run build:en    # production build, English -> dist-en/
npm run build:ru    # production build, Russian -> dist-ru/
```
