// Diff semantico del contratto OpenAPI Accessi.
//
// Il fingerprint (`check-accessi-openapi.cjs`) blocca rimozioni di operation e
// schema. Questo script confronta la semantica (tipi, required, enum, parametri,
// security) con una baseline versionata e fallisce sui breaking change non
// approvati. Le eccezioni vivono in `docs/accessi-openapi-breaking-allowlist.json`
// e devono avere una motivazione: sono pensate per un singolo rilascio.
//
// Uso:
//   node scripts/openapi-semantic-diff.cjs                 verifica (CI/build)
//   node scripts/openapi-semantic-diff.cjs --update        rigenera la baseline
//   node scripts/openapi-semantic-diff.cjs --verbose       mostra anche i non-breaking
const fs = require('node:fs');
const path = require('node:path');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
const SPEC_PATH = path.join(__dirname, '..', 'src', 'accessi-module', 'openapi', 'accessi.openapi.json');
const BASELINE_PATH = path.join(__dirname, '..', 'docs', 'accessi-openapi-baseline.json');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'docs', 'accessi-openapi-breaking-allowlist.json');

function resolveRef(document, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let current = document;
  for (const part of ref.slice(2).split('/')) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return current;
}

function normalizeSchema(schema, document, depth = 0) {
  if (!schema || typeof schema !== 'object') return { type: 'any' };
  if (typeof schema.$ref === 'string') {
    return { ref: schema.$ref.split('/').pop() };
  }
  if (depth > 20) return { type: 'recursive' };

  const normalized = {};
  if (schema.type) normalized.type = Array.isArray(schema.type) ? [...schema.type].sort() : schema.type;
  if (Array.isArray(schema.enum)) normalized.enum = schema.enum.map((value) => JSON.stringify(value)).sort();
  if (schema.nullable === true) normalized.nullable = true;
  if (schema.format) normalized.format = schema.format;
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    normalized.required = [...schema.required].sort();
  }
  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        normalizeSchema(property, document, depth + 1),
      ]),
    );
  }
  if (schema.items) normalized.items = normalizeSchema(schema.items, document, depth + 1);
  if (schema.additionalProperties === false) normalized.additionalProperties = false;
  for (const composition of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[composition])) {
      normalized[composition] = schema[composition].map((entry) => normalizeSchema(entry, document, depth + 1));
    }
  }
  for (const constraint of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) {
    if (schema[constraint] !== undefined) normalized[constraint] = schema[constraint];
  }
  if (Object.keys(normalized).length === 0) normalized.type = 'any';
  return normalized;
}

function normalizeParameters(parameters, document) {
  const normalized = {};
  for (const parameter of parameters ?? []) {
    const resolved = parameter?.$ref ? resolveRef(document, parameter.$ref) : parameter;
    if (!resolved?.name || !resolved?.in) continue;
    normalized[`${resolved.in}:${resolved.name}`] = {
      required: resolved.required === true,
      schema: normalizeSchema(resolved.schema, document),
    };
  }
  return normalized;
}

function normalizeRequestBody(requestBody, document) {
  if (!requestBody) return null;
  const resolved = requestBody.$ref ? resolveRef(document, requestBody.$ref) : requestBody;
  if (!resolved) return null;
  const content = resolved.content ?? {};
  const mediaType = Object.keys(content).sort()[0];
  if (!mediaType) return null;
  return {
    required: resolved.required === true,
    schema: normalizeSchema(content[mediaType].schema, document),
  };
}

function normalizeResponses(responses, document) {
  const normalized = {};
  for (const [status, response] of Object.entries(responses ?? {})) {
    const resolved = response?.$ref ? resolveRef(document, response.$ref) : response;
    if (!resolved) continue;
    const content = resolved.content ?? {};
    const mediaType = Object.keys(content).sort()[0];
    normalized[status] = mediaType
      ? normalizeSchema(content[mediaType].schema, document)
      : { type: 'none' };
  }
  return normalized;
}

/** Estrae la parte semantica del documento: operations e schemi. */
function buildSnapshot(document) {
  const operations = {};
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      const id = operation.operationId ?? `${method} ${route}`;
      operations[id] = {
        method: method.toUpperCase(),
        path: route,
        security: (operation.security ?? document.security ?? [])
          .map((requirement) => Object.keys(requirement).sort().join(','))
          .sort(),
        parameters: normalizeParameters(
          [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])],
          document,
        ),
        requestBody: normalizeRequestBody(operation.requestBody, document),
        responses: normalizeResponses(operation.responses, document),
      };
    }
  }

  const schemas = {};
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    schemas[name] = normalizeSchema(schema, document);
  }

  return { operations, schemas };
}

function schemaDiff(base, current, context, location, breaking, nonBreaking) {
  if (!base || !current) return;
  const baseRef = base.ref;
  const currentRef = current.ref;
  if (baseRef !== currentRef) {
    breaking.push({
      id: `${location}:ref`,
      message: `${location}: riferimento schema cambiato (${baseRef ?? 'inline'} -> ${currentRef ?? 'inline'})`,
    });
    return;
  }
  if (baseRef) return;

  const baseType = JSON.stringify(base.type);
  const currentType = JSON.stringify(current.type);
  if (baseType !== currentType) {
    breaking.push({ id: `${location}:type`, message: `${location}: tipo cambiato (${baseType} -> ${currentType})` });
  }
  if ((base.format ?? null) !== (current.format ?? null)) {
    breaking.push({
      id: `${location}:format`,
      message: `${location}: formato cambiato (${base.format ?? 'assente'} -> ${current.format ?? 'assente'})`,
    });
  }
  if (Boolean(base.nullable) !== Boolean(current.nullable)) {
    const message = `${location}: nullable cambiato (${Boolean(base.nullable)} -> ${Boolean(current.nullable)})`;
    if (base.nullable && !current.nullable) breaking.push({ id: `${location}:nullable`, message });
    else nonBreaking.push({ id: `${location}:nullable`, message });
  }

  const baseEnum = new Set(base.enum ?? []);
  const currentEnum = new Set(current.enum ?? []);
  if (baseEnum.size > 0 || currentEnum.size > 0) {
    for (const value of baseEnum) {
      if (!currentEnum.has(value)) {
        breaking.push({ id: `${location}:enum:${value}`, message: `${location}: valore enum rimosso (${value})` });
      }
    }
    for (const value of currentEnum) {
      if (!baseEnum.has(value)) {
        nonBreaking.push({ id: `${location}:enum:new:${value}`, message: `${location}: nuovo valore enum (${value})` });
      }
    }
  }

  const baseProperties = base.properties ?? {};
  const currentProperties = current.properties ?? {};
  const baseRequired = new Set(base.required ?? []);
  const currentRequired = new Set(current.required ?? []);
  for (const name of baseRequired) {
    if (!currentRequired.has(name)) {
      const message = `${location}.${name}: non piu required`;
      if (context === 'response') breaking.push({ id: `${location}.${name}:required:removed`, message });
      else nonBreaking.push({ id: `${location}.${name}:required:removed`, message });
    }
  }
  for (const name of currentRequired) {
    // Le proprieta nuove sono gestite dal loop su properties: qui interessano
    // solo i cambi di required su proprieta presenti in entrambe le versioni.
    if (baseRequired.has(name) || !(name in baseProperties) || !(name in currentProperties)) continue;
    const message = `${location}.${name}: ora required`;
    if (context === 'request') breaking.push({ id: `${location}.${name}:required:added`, message });
    else nonBreaking.push({ id: `${location}.${name}:required:added`, message });
  }

  for (const [name, property] of Object.entries(baseProperties)) {
    if (!(name in currentProperties)) {
      breaking.push({
        id: `${location}.${name}:removed`,
        message: `${location}.${name}: proprieta rimossa`,
      });
      continue;
    }
    schemaDiff(property, currentProperties[name], context, `${location}.${name}`, breaking, nonBreaking);
  }
  for (const [name, property] of Object.entries(currentProperties)) {
    if (name in baseProperties) continue;
    const message = `${location}.${name}: nuova proprieta`;
    if (context === 'request' && currentRequired.has(name)) {
      breaking.push({ id: `${location}.${name}:added:required`, message: `${message} required` });
    } else {
      nonBreaking.push({ id: `${location}.${name}:added`, message });
    }
  }

  if (base.items || current.items) {
    schemaDiff(base.items, current.items, context, `${location}[]`, breaking, nonBreaking);
  }

  if (context === 'request') {
    // Un vincolo piu stretto sull'input rompe i chiamanti esistenti.
    for (const constraint of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) {
      if (JSON.stringify(base[constraint]) === JSON.stringify(current[constraint])) continue;
      const tightened = ['minimum', 'minLength'].includes(constraint)
        ? Number(current[constraint]) > Number(base[constraint] ?? 0)
        : ['maximum', 'maxLength'].includes(constraint)
          ? Number(current[constraint]) < Number(base[constraint] ?? Number.POSITIVE_INFINITY)
          : true;
      if (tightened) {
        breaking.push({
          id: `${location}:${constraint}`,
          message: `${location}: vincolo ${constraint} cambiato (${base[constraint] ?? 'assente'} -> ${current[constraint] ?? 'assente'})`,
        });
      }
    }
  }

  if (base.additionalProperties === false && current.additionalProperties !== false) {
    nonBreaking.push({
      id: `${location}:additionalProperties`,
      message: `${location}: additionalProperties ora consentito`,
    });
  }
  if (base.additionalProperties !== false && current.additionalProperties === false && context === 'request') {
    breaking.push({
      id: `${location}:additionalProperties`,
      message: `${location}: additionalProperties: false sull'input`,
    });
  }
}

/** Confronta due snapshot e separa breaking e non-breaking. */
function diffSnapshots(baseline, current) {
  const breaking = [];
  const nonBreaking = [];

  // Un'operation rimossa e gia bloccata dal fingerprint, ma qui serve per il
  // messaggio unico e per l'allowlist.
  for (const id of Object.keys(baseline.operations ?? {})) {
    if (!current.operations?.[id]) {
      breaking.push({ id: `operation:${id}:removed`, message: `operation ${id}: rimossa` });
    }
  }
  for (const id of Object.keys(current.operations ?? {})) {
    if (!baseline.operations?.[id]) {
      nonBreaking.push({ id: `operation:${id}:added`, message: `operation ${id}: aggiunta` });
    }
  }

  for (const [id, before] of Object.entries(baseline.operations ?? {})) {
    const after = current.operations?.[id];
    if (!after) continue;

    if (before.method !== after.method || before.path !== after.path) {
      breaking.push({
        id: `operation:${id}:route`,
        message: `operation ${id}: route cambiata (${before.method} ${before.path} -> ${after.method} ${after.path})`,
      });
    }
    if (JSON.stringify(before.security) !== JSON.stringify(after.security)) {
      breaking.push({
        id: `operation:${id}:security`,
        message: `operation ${id}: security cambiata (${JSON.stringify(before.security)} -> ${JSON.stringify(after.security)})`,
      });
    }

    for (const [key, parameter] of Object.entries(before.parameters ?? {})) {
      const next = after.parameters?.[key];
      if (!next) {
        breaking.push({ id: `operation:${id}:parameter:${key}:removed`, message: `${id}: parametro rimosso (${key})` });
        continue;
      }
      if (parameter.required !== next.required) {
        const message = `${id}: parametro ${key} required ${parameter.required} -> ${next.required}`;
        if (next.required) {
          breaking.push({ id: `operation:${id}:parameter:${key}:required`, message });
        } else {
          nonBreaking.push({ id: `operation:${id}:parameter:${key}:optional`, message });
        }
      }
      schemaDiff(parameter.schema, next.schema, 'request', `operation:${id}:parameter:${key}`, breaking, nonBreaking);
    }
    for (const key of Object.keys(after.parameters ?? {})) {
      if (before.parameters?.[key]) continue;
      const message = `${id}: nuovo parametro (${key})`;
      if (after.parameters[key].required) {
        breaking.push({ id: `operation:${id}:parameter:${key}:added:required`, message });
      } else {
        nonBreaking.push({ id: `operation:${id}:parameter:${key}:added`, message });
      }
    }

    if (before.requestBody || after.requestBody) {
      if (!before.requestBody && after.requestBody) {
        const message = `${id}: request body aggiunto`;
        if (after.requestBody.required) {
          breaking.push({ id: `operation:${id}:requestBody:added:required`, message });
        } else {
          nonBreaking.push({ id: `operation:${id}:requestBody:added`, message });
        }
      } else if (before.requestBody && !after.requestBody) {
        breaking.push({ id: `operation:${id}:requestBody:removed`, message: `${id}: request body rimosso` });
      } else {
        if (before.requestBody.required !== after.requestBody.required) {
          const message = `${id}: request body required ${before.requestBody.required} -> ${after.requestBody.required}`;
          if (after.requestBody.required) {
            breaking.push({ id: `operation:${id}:requestBody:required`, message });
          } else {
            nonBreaking.push({ id: `operation:${id}:requestBody:optional`, message });
          }
        }
        schemaDiff(
          before.requestBody.schema,
          after.requestBody.schema,
          'request',
          `operation:${id}:requestBody`,
          breaking,
          nonBreaking,
        );
      }
    }

    for (const [status, response] of Object.entries(before.responses ?? {})) {
      const next = after.responses?.[status];
      if (!next) {
        breaking.push({ id: `operation:${id}:response:${status}:removed`, message: `${id}: risposta ${status} rimossa` });
        continue;
      }
      schemaDiff(response, next, 'response', `operation:${id}:response:${status}`, breaking, nonBreaking);
    }
    for (const status of Object.keys(after.responses ?? {})) {
      if (before.responses?.[status]) continue;
      nonBreaking.push({ id: `operation:${id}:response:${status}:added`, message: `${id}: nuova risposta ${status}` });
    }
  }

  for (const name of Object.keys(baseline.schemas ?? {})) {
    if (!current.schemas?.[name]) {
      breaking.push({ id: `schema:${name}:removed`, message: `schema ${name}: rimosso` });
      continue;
    }
    // Gli schemi possono essere usati sia in input sia in output: si applicano le
    // regole piu prudenti (input piu restrittivo = breaking).
    schemaDiff(baseline.schemas[name], current.schemas[name], 'request', `schema:${name}`, breaking, nonBreaking);
  }
  for (const name of Object.keys(current.schemas ?? {})) {
    if (!baseline.schemas?.[name]) {
      nonBreaking.push({ id: `schema:${name}:added`, message: `schema ${name}: aggiunto` });
    }
  }

  return { breaking, nonBreaking };
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${ALLOWLIST_PATH} deve contenere un array di eccezioni.`);
  }
  return parsed;
}

/** Applica l'allowlist: ritorna le violazioni e le eccezioni non piu necessarie. */
function applyAllowlist(breaking, allowlist) {
  const violations = [];
  const applied = [];
  const used = new Set();

  for (const change of breaking) {
    const exception = allowlist.find((entry) => entry?.id === change.id);
    if (!exception) {
      violations.push(change);
      continue;
    }
    used.add(exception.id);
    if (typeof exception.reason !== 'string' || exception.reason.trim() === '') {
      violations.push({ ...change, message: `${change.message} (eccezione senza reason)` });
      continue;
    }
    applied.push({ change, exception });
  }

  const stale = allowlist.filter((entry) => entry?.id && !used.has(entry.id));
  return { violations, applied, stale };
}

function main() {
  const argv = process.argv.slice(2);
  const update = argv.includes('--update');
  const verbose = argv.includes('--verbose');

  if (!fs.existsSync(SPEC_PATH)) {
    console.error(`OpenAPI non trovato: ${SPEC_PATH}. Eseguire npm run generate:accessi-openapi.`);
    process.exit(1);
  }
  const document = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const snapshot = buildSnapshot(document);

  if (update) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(
      `Baseline OpenAPI aggiornata: ${BASELINE_PATH} (${Object.keys(snapshot.operations).length} operation, ${Object.keys(snapshot.schemas).length} schemi).`,
    );
    return;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(
      `Baseline OpenAPI mancante: ${BASELINE_PATH}. Eseguire npm run accessi:update-openapi-baseline.`,
    );
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const { breaking, nonBreaking } = diffSnapshots(baseline, snapshot);
  const { violations, applied, stale } = applyAllowlist(breaking, loadAllowlist());

  if (breaking.length === 0) {
    console.log('Diff semantico OpenAPI: nessun breaking change.');
    if (verbose && nonBreaking.length > 0) {
      for (const change of nonBreaking) console.log(`  [ok] ${change.message}`);
    }
    return;
  }

  for (const { change, exception } of applied) {
    console.log(`  [eccezione] ${change.message}\n    motivo: ${exception.reason}${exception.issue ? ` (${exception.issue})` : ''}`);
  }
  if (verbose) {
    for (const change of nonBreaking) console.log(`  [ok] ${change.message}`);
  }

  if (stale.length > 0) {
    console.error('Eccezioni OpenAPI obsolete (il breaking change non esiste piu):');
    for (const entry of stale) console.error(`  - ${entry.id}${entry.reason ? ` (${entry.reason})` : ''}`);
    console.error('Rimuoverle da docs/accessi-openapi-breaking-allowlist.json.');
  }

  if (violations.length > 0) {
    console.error(`Breaking change OpenAPI non approvati (${violations.length}):`);
    for (const change of violations) console.error(`  - ${change.id}: ${change.message}`);
    console.error(
      'Se il cambio e intenzionale, aggiungerlo a docs/accessi-openapi-breaking-allowlist.json con una reason e (se esiste) la issue, poi rigenerare la baseline con npm run accessi:update-openapi-baseline.',
    );
  }

  if (violations.length > 0 || stale.length > 0) {
    process.exit(1);
  }

  console.log('Diff semantico OpenAPI OK (breaking change coperti da eccezioni motivate).');
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWLIST_PATH,
  BASELINE_PATH,
  buildSnapshot,
  diffSnapshots,
  applyAllowlist,
  normalizeSchema,
};
