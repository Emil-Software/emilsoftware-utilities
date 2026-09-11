import { defineConfig } from 'orval';

export default defineConfig({
  accessiConsole: {
    input: { target: './src/accessi-module/openapi/accessi.openapi.json' },
    output: {
      target: './src/accessi-module/Console/generated/accessiApi.ts',
      schemas: './src/accessi-module/Console/generated/model',
      client: 'fetch',
      mode: 'single',
      override: {
        mutator: {
          path: './src/accessi-module/Console/accessiFetch.ts',
          name: 'accessiFetch',
        },
      },
    },
  },
});
