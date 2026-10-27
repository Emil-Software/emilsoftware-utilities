require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MENU_SCOPE_SEED,
  MENU_SCOPE_SEED_VERSION,
  SCOPE_SEED,
} = require('../src/accessi-module/database-updates/menuScopeSeed');

test('seed scope: catalogo coerente e associato ai menu', () => {
  const scopeCodes = new Set(SCOPE_SEED.map((scope) => scope.code));
  assert.equal(scopeCodes.size, SCOPE_SEED.length, 'scope duplicati');
  assert.ok(SCOPE_SEED.length >= 6, 'mancano gli scope delle applicazioni');
  assert.match(MENU_SCOPE_SEED_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);

  const entries = Object.entries(MENU_SCOPE_SEED);
  assert.ok(entries.length >= 300, `menu nel seed insufficienti: ${entries.length}`);
  for (const [menu, scopes] of entries) {
    assert.ok(scopes.length > 0, `${menu} senza scope`);
    for (const scope of scopes) {
      assert.ok(scopeCodes.has(scope), `${menu}: scope sconosciuto ${scope}`);
    }
  }

  const shared = entries.filter(([, scopes]) => scopes.length > 1);
  assert.ok(shared.length >= 50, `menu condivisi attesi, trovati ${shared.length}`);
});

test('seed scope: i codici menu rispettano il limite della colonna', () => {
  for (const menu of Object.keys(MENU_SCOPE_SEED)) {
    assert.ok(menu.length <= 20, `codice menu troppo lungo: ${menu}`);
  }
  for (const scope of SCOPE_SEED) {
    assert.ok(scope.code.length <= 20, `codice scope troppo lungo: ${scope.code}`);
    assert.ok(scope.name.trim().length > 0, `scope ${scope.code} senza nome`);
  }
});
