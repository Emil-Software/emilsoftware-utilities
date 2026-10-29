const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const COMPONENT_DIR = path.join(ROOT, 'src', 'angular-components', 'aree-disponibili');
const SCRIPT = path.join(COMPONENT_DIR, 'aree-disponibili.js');

function loadComponentSandbox() {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const sandbox = {
    console,
    HTMLElement: class {},
    customElements: {
      registry: new Map(),
      get(name) {
        return this.registry.get(name);
      },
      define(name, constructor) {
        this.registry.set(name, constructor);
      },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: SCRIPT });
  return sandbox;
}

test('aree-disponibili: web component self-contained e frameworkless', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  assert.doesNotThrow(() => new Function(source));

  assert.match(source, /customElements\.define\(TAG, AreeDisponibiliElement\)/);
  assert.match(source, /const TAG = 'es-aree-disponibili'/);
  assert.match(source, /es-area-select/);
  assert.match(source, /es-area-blocked/);
  assert.doesNotMatch(source, /from\s+['"]@angular/);
  assert.doesNotMatch(source, /from\s+['"]react/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\/[^\s'"]+\.(?:js|css)/);
});

test('aree-disponibili: temi light/dark, default light e token sovrascrivibili', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  assert.match(source, /data-resolved-theme="dark"/);
  assert.match(source, /prefers-color-scheme/);
  assert.match(source, /data-bs-theme/);
  assert.match(source, /ion-palette-dark/);
  assert.match(source, /--es-primary/);
  assert.match(source, /--es-surface/);
  assert.match(source, /color-scheme:\s*light/);
  assert.match(source, /color-scheme:\s*dark/);
  assert.match(
    source,
    /get theme\(\) \{\s*return this\.getAttribute\('theme'\) \|\| 'light';/,
  );
});

test('aree-disponibili: buildModel condiviso raggruppa e risolve le rotte', () => {
  const sandbox = loadComponentSandbox();
  const api = sandbox.window.EmilSoftware.AreeDisponibili;
  assert.ok(api, 'API EmilSoftware.AreeDisponibili mancante');
  assert.equal(typeof api.buildModel, 'function');

  const grants = [
    { codiceMenu: 'MNUMAIN', descrizioneMenu: 'Home', codiceGruppo: 'G', descrizioneGruppo: 'Generale', pagina: '/main', tipo: 'M', icona: 'home-outline' },
    { codiceMenu: 'MNUAVANZA', descrizioneMenu: 'Avanzamento', codiceGruppo: 'P', descrizioneGruppo: 'Produzione', pagina: '/avanzamento', tipo: 'M' },
    { codiceMenu: 'CQ_ARRIVI', descrizioneMenu: 'Arrivi CQ', codiceGruppo: 'U', descrizioneGruppo: 'Qualita', pagina: 'arrivi', tipo: 'M' },
    { codiceMenu: 'WIDGET', descrizioneMenu: 'Widget', codiceGruppo: 'P', descrizioneGruppo: 'Produzione', pagina: '', tipo: 'M' },
    { codiceMenu: 'PERMESSO', descrizioneMenu: 'Permesso', codiceGruppo: 'P', descrizioneGruppo: 'Produzione', pagina: '/x', tipo: 'A' },
  ];

  const groups = api.buildModel(grants, {
    routeMap: { CQ_ARRIVI: '/cq-arrivi' },
    availableRoutes: ['/main'],
    groupOrder: { G: 5, P: 4, U: 16 },
    menuOrder: { MNUMAIN: 1, MNUAVANZA: 2, CQ_ARRIVI: 3 },
  });

  assert.deepEqual(
    Array.from(groups, (group) => group.name),
    ['Produzione', 'Generale', 'Qualita'],
  );
  assert.equal(groups.length, 3);

  const byCode = new Map(
    groups.flatMap((group) => group.areas).map((area) => [area.code, area]),
  );
  assert.equal(byCode.size, 3);
  assert.equal(byCode.get('MNUMAIN').available, true);
  assert.equal(byCode.get('MNUMAIN').route, '/main');
  assert.equal(byCode.get('CQ_ARRIVI').available, true);
  assert.equal(byCode.get('CQ_ARRIVI').route, '/cq-arrivi');
  assert.equal(byCode.get('MNUAVANZA').available, false);
  assert.equal(byCode.get('MNUAVANZA').page, '/avanzamento');
  assert.equal(byCode.has('WIDGET'), false);
  assert.equal(byCode.has('PERMESSO'), false);
});

test('aree-disponibili: accetta anche i grant gia raggruppati (mnuAbil)', () => {
  const sandbox = loadComponentSandbox();
  const api = sandbox.window.EmilSoftware.AreeDisponibili;

  const groups = api.buildModel(
    [
      {
        codGrp: 'P',
        desGrp: 'Produzione',
        menu: [
          { codMnu: 'MNUMAIN', desMnu: 'Home', pagina: '/main', tipo: 'M', icon: 'home-outline' },
        ],
      },
    ],
    { availableRoutes: ['/main'], groupOrder: { P: 4 } },
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Produzione');
  assert.equal(groups[0].areas[0].label, 'Home');
  assert.equal(groups[0].areas[0].route, '/main');
});

test('aree-disponibili: documentazione e demo presenti', () => {
  for (const file of ['README.md', 'demo.html']) {
    assert.ok(
      fs.existsSync(path.join(COMPONENT_DIR, file)),
      `${file} mancante`,
    );
  }

  const copy = fs.readFileSync(path.join(ROOT, 'copy-views.js'), 'utf8');
  for (const extension of ['.js', '.css', '.html']) {
    assert.ok(copy.includes(`"${extension}"`), `${extension} non copiato in dist`);
  }
});
