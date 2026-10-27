const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMPONENT_DIR = path.join(ROOT, 'src', 'angular-components', 'aree-disponibili');
const SCRIPT = path.join(COMPONENT_DIR, 'aree-disponibili.js');

test('aree-disponibili: web component self-contained e frameworkless', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  // Sintassi valida senza eseguire il file (customElements non esiste in Node).
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

test('aree-disponibili: temi light/dark e token sovrascrivibili', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  assert.match(source, /data-resolved-theme="dark"/);
  assert.match(source, /prefers-color-scheme/);
  assert.match(source, /data-bs-theme/);
  assert.match(source, /ion-palette-dark/);
  assert.match(source, /--es-primary/);
  assert.match(source, /--es-surface/);
  assert.match(source, /color-scheme:\s*light/);
  assert.match(source, /color-scheme:\s*dark/);
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
