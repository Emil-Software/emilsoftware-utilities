import { defineConfig } from 'orval';

const mutator = {
  path: './src/accessi-module/Console/accessiFetch.ts',
  name: 'accessiFetch',
};

/** Modelli condivisi da tutti i client: un solo set di tipi per scope diversi. */
const schemas = './src/accessi-module/Console/generated/model';

export default defineConfig({
  // Client completo: retrocompatibile, include ogni endpoint.
  'emilsoftware-utilities': {
    input: { target: './src/accessi-module/openapi/accessi.openapi.json' },
    output: {
      target: './src/accessi-module/Console/generated/emilsoftware-utilities.ts',
      schemas,
      client: 'fetch',
      mode: 'single',
      override: { mutator },
    },
  },
  // Client ridotti per scope: il frontend pubblico non importa operazioni admin.
  'accessi-client-public': {
    input: {
      target: './src/accessi-module/openapi/accessi.openapi.json',
      filters: { mode: 'include', tags: ['Auth', 'Email'] },
    },
    output: {
      target: './src/accessi/client/generated/public.ts',
      schemas,
      client: 'fetch',
      mode: 'single',
      override: { mutator },
    },
  },
  'accessi-client-admin': {
    input: {
      target: './src/accessi-module/openapi/accessi.openapi.json',
      filters: {
        mode: 'include',
        tags: [
          'Permission',
          'User',
          'Filtri',
          'Configurator',
          'Console',
          'Federated authentication',
          'Schema',
        ],
      },
    },
    output: {
      target: './src/accessi/client/generated/admin.ts',
      schemas,
      client: 'fetch',
      mode: 'single',
      override: { mutator },
    },
  },
  'accessi-client-service': {
    input: {
      target: './src/accessi-module/openapi/accessi.openapi.json',
      filters: { mode: 'include', tags: ['ServiceToken'] },
    },
    output: {
      target: './src/accessi/client/generated/service.ts',
      schemas,
      client: 'fetch',
      mode: 'single',
      override: { mutator },
    },
  },
});
