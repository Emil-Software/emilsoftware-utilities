const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schemaSource = fs.readFileSync(
  path.join(root, 'src', 'accessi-service', 'database-updates', 'accessiSchema.ts'),
  'utf8',
);
const snapshot = fs.readFileSync(
  path.join(root, 'src', 'accessi-service', 'docs', 'accessi.sql'),
  'utf8',
);
const databaseDoc = fs.readFileSync(
  path.join(root, 'src', 'accessi-service', 'docs', 'database-update.md'),
  'utf8',
);

function schemaVersion() {
  const match = /ACCESSI_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(schemaSource);
  assert.ok(match, 'ACCESSI_SCHEMA_VERSION non trovata in accessiSchema.ts');
  return match[1];
}

test('#33: lo snapshot SQL usa la stessa versione dello schema', () => {
  const version = schemaVersion();
  const firstLine = snapshot.split(/\r?\n/, 1)[0];
  assert.match(
    firstLine,
    new RegExp(`Generic Accessi schema ${version.replace(/\./g, '\\.')}\\b`),
    `Lo snapshot deve dichiarare la versione ${version}: ${firstLine}`,
  );
});

test('#33: la documentazione cita versione e percorso corretti dello snapshot', () => {
  const version = schemaVersion();
  assert.ok(
    databaseDoc.includes(`oggi \`${version}\``),
    `database-update.md deve citare la versione ${version}`,
  );
  assert.ok(
    databaseDoc.includes('`accessi.sql`'),
    'database-update.md deve citare accessi.sql nella stessa cartella',
  );
  assert.ok(
    !databaseDoc.includes('docs/accessi.sql'),
    'database-update.md non deve citare il vecchio percorso docs/accessi.sql',
  );
  assert.ok(
    !databaseDoc.includes('1.11.1'),
    'database-update.md non deve contenere la vecchia versione 1.11.1',
  );
});
