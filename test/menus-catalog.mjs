import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  loadRegistry,
  readCatalog,
  validateCatalog,
  buildGeneratedTs,
  appPaths,
  diffMenu,
  diffGroup,
  diffType,
  humanize,
} from '../scripts/menus/lib.mjs';

// I cataloghi vivono nei repository delle app: in una clone isolata di
// emilsoftware-utilities non ci sono e i test sul catalogo vengono saltati.
const apps = loadRegistry().apps.filter((app) => fs.existsSync(appPaths(app).catalog));

test('cataloghi menu: ogni app ha un catalogo valido', { skip: apps.length === 0 }, () => {
  for (const app of apps) {
    const catalog = readCatalog(app);
    assert.deepEqual(validateCatalog(catalog, app.app), [], `${app.app} non valido`);
    assert.ok(catalog.menus.length > 0, `${app.app} senza menu`);
  }
});

test('cataloghi menu: i file TypeScript generati sono aggiornati', { skip: apps.length === 0 }, () => {
  for (const app of apps) {
    const catalog = readCatalog(app);
    const expected = buildGeneratedTs(app, catalog);
    assert.ok(fs.existsSync(appPaths(app).generated), `${app.app}: file generato assente`);
    const current = fs.readFileSync(appPaths(app).generated, 'utf8');
    assert.equal(current, expected, `${app.app}: esegui npm run menus:generate`);
  }
});

test('diffMenu: solo i campi dichiarati dal catalogo', () => {
  const actual = {
    codiceMenu: 'X',
    descrizioneMenu: 'Vecchia',
    codiceGruppo: 'A',
    tipo: 'M',
    ordineMenu: 10,
    enabled: true,
  };
  assert.deepEqual(diffMenu({ codiceMenu: 'X', descrizioneMenu: 'Nuova' }, actual), {
    descrizioneMenu: 'Nuova',
  });
  assert.deepEqual(diffMenu({ codiceMenu: 'X' }, actual), {});
  assert.deepEqual(diffMenu({ codiceMenu: 'X', enabled: false }, actual), { enabled: false });
  assert.deepEqual(diffMenu({ codiceMenu: 'X', ordineMenu: 20 }, actual), { ordineMenu: 20 });
});

test('diffGroup e diffType: confronto dei soli campi presenti', () => {
  const group = { codiceGruppo: 'A', descrizioneGruppo: 'X', ordineGruppo: 1, enabled: true };
  assert.deepEqual(diffGroup({ descrizioneGruppo: 'X' }, group), {});
  assert.deepEqual(diffGroup({ descrizioneGruppo: 'Y' }, group), { descrizioneGruppo: 'Y' });
  const type = { codiceTipo: 'M', descrizioneTipo: 'Menu' };
  assert.deepEqual(diffType({ descrizioneTipo: 'Menu' }, type), {});
  assert.deepEqual(diffType({ descrizioneTipo: 'Altro' }, type), { descrizioneTipo: 'Altro' });
});

test('humanize: etichette leggibili dai codici', () => {
  assert.equal(humanize('MENU_MAIN'), 'Main');
  assert.equal(humanize('WIDGET_CONTA_CLIENTI'), 'Conta clienti');
  assert.equal(humanize('INV_EXPCSV'), 'Expcsv');
  assert.equal(humanize('WKPI'), 'Kpi');
});
