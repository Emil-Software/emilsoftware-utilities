import { defineConfig } from 'orval';

export default defineConfig({
  'emilsoftware-utilities': {
    input: { target: './src/accessi-module/openapi/accessi.openapi.json' },
    output: {
      target: './src/accessi-module/Console/generated/emilsoftware-utilities.ts',
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
