// Gate di compatibilita del contratto OpenAPI Accessi.
// Non fa diff semantico: blocca errori strutturali e regressioni note prima di
// generare client e tipi.
const fs = require('node:fs');
const path = require('node:path');

const specPath = path.join(__dirname, '..', 'src', 'accessi-module', 'openapi', 'accessi.openapi.json');
const fingerprintPath = path.join(__dirname, '..', 'docs', 'accessi-openapi-fingerprint.json');
const updateFingerprint = process.argv.includes('--update');
const failures = [];

function fail(message) {
  failures.push(message);
}

if (!fs.existsSync(specPath)) {
  fail(`OpenAPI non trovato: ${specPath}. Eseguire npm run generate:accessi-openapi.`);
} else {
  const document = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const paths = document.paths && typeof document.paths === 'object' ? document.paths : {};
  const operationIds = new Set();
  const componentCache = new Map();

  const resolveRef = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return true;
    if (componentCache.has(ref)) return componentCache.get(ref);
    const parts = ref.slice(2).split('/');
    let current = document;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        componentCache.set(ref, false);
        return false;
      }
      current = current[part];
    }
    componentCache.set(ref, true);
    return true;
  };

  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && !resolveRef(value.$ref)) {
      fail(`$ref non risolvibile: ${value.$ref}`);
    }
    Object.values(value).forEach(walk);
  };

  if (!String(document.openapi ?? '').startsWith('3.')) {
    fail(`Versione OpenAPI inattesa: ${document.openapi}`);
  }

  for (const [route, operations] of Object.entries(paths)) {
    if (!route.startsWith('/api/accessi')) {
      fail(`Path fuori dal prefisso /api/accessi: ${route}`);
    }
    if (/[()*]/.test(route)) {
      fail(`Path con sintassi legacy o wildcard non ammessa: ${route}`);
    }
    for (const [method, operation] of Object.entries(operations ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) continue;
      const operationId = operation?.operationId;
      if (!operationId) {
        fail(`operationId mancante: ${method.toUpperCase()} ${route}`);
      } else if (operationIds.has(operationId)) {
        fail(`operationId duplicato: ${operationId}`);
      } else {
        operationIds.add(operationId);
      }
    }
  }

  const securitySchemes = document.components?.securitySchemes ?? {};
  if (!securitySchemes.bearer && !securitySchemes.BearerAuth) {
    fail('Security scheme bearer/BearerAuth mancante.');
  }

  for (const requiredPath of [
    '/api/accessi/auth/login',
    '/api/accessi/auth/introspect',
    '/api/accessi/federated-auth/exchange',
    '/api/accessi/console/entry',
  ]) {
    if (!paths[requiredPath]) {
      fail(`Path obbligatorio mancante: ${requiredPath}`);
    }
  }

  walk(document);

  if (operationIds.size < 20) {
    fail(`Numero operationId sospetto: ${operationIds.size}`);
  }

  const fingerprint = {
    paths: Object.entries(paths)
      .flatMap(([route, operations]) =>
        Object.entries(operations ?? {})
          .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method))
          .map(([method, operation]) => `${method.toUpperCase()} ${route} ${operation?.operationId ?? ''}`),
      )
      .sort(),
    schemas: Object.keys(document.components?.schemas ?? {}).sort(),
    securitySchemes: Object.keys(securitySchemes).sort(),
  };

  if (updateFingerprint) {
    fs.mkdirSync(path.dirname(fingerprintPath), { recursive: true });
    fs.writeFileSync(fingerprintPath, `${JSON.stringify(fingerprint, null, 2)}\n`);
    console.log(`Fingerprint OpenAPI aggiornato: ${fingerprintPath}`);
  } else if (fs.existsSync(fingerprintPath)) {
    const baseline = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
    const currentPaths = new Set(fingerprint.paths);
    const currentSchemas = new Set(fingerprint.schemas);
    const currentSecuritySchemes = new Set(fingerprint.securitySchemes);

    for (const operation of baseline.paths ?? []) {
      if (!currentPaths.has(operation)) {
        fail(`Operation rimossa o operationId modificato: ${operation}`);
      }
    }
    for (const schema of baseline.schemas ?? []) {
      if (!currentSchemas.has(schema)) {
        fail(`Schema rimosso: ${schema}`);
      }
    }
    for (const scheme of baseline.securitySchemes ?? []) {
      if (!currentSecuritySchemes.has(scheme)) {
        fail(`Security scheme rimosso: ${scheme}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Contratto OpenAPI Accessi non valido (${failures.length} errori):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('Contratto OpenAPI Accessi OK.');
