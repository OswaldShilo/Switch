import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nested under frontend/ (which has its own postcss.config.mjs for Tailwind),
  // Vite's postcss-load-config walks up from this package's cwd and would
  // otherwise pick up that unrelated Tailwind config for this plain TS package.
  // An inline (empty) postcss config short-circuits that filesystem search.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: 'node',
  },
});
