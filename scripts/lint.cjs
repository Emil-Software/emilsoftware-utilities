// Lint leggero e dependency-free: regole di igiene che il typecheck da solo non copre.
// Non sostituisce ESLint, ma blocca pattern rischiosi in CI senza aggiungere dipendenze.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');

/** File in cui l'output su console e intenzionale (logger o CLI). */
const CONSOLE_ALLOWED = new Set(['Logger.ts', 'runAccessiDbUpdate.ts', 'runAccessiCatalogMigrations.ts', 'generateAccessiOpenApi.ts']);

const RULES = [
  { id: 'type-any', description: 'Uso di `any` come tipo (usare `unknown` o un tipo specifico)', pattern: /:\s*any\b|<any>|as any\b|any\[\]/ },
  { id: 'ts-ignore', description: 'Soppressione del typecheck', pattern: /@ts-(ignore|nocheck|expect-error)/ },
  { id: 'debugger', description: 'Istruzione `debugger`', pattern: /\bdebugger\b/ },
];

const CONSOLE_PATTERN = /console\.(log|error|info|debug|warn)\s*\(/;

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Ignora commenti di riga e JSDoc, per non segnalare esempi testuali. */
function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

const findings = [];

for (const file of listFiles(srcDir)) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const baseName = path.basename(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isComment(line)) return;

    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file: relative, line: index + 1, rule: rule.id, description: rule.description, text: line.trim() });
      }
    }

    if (CONSOLE_PATTERN.test(line) && !CONSOLE_ALLOWED.has(baseName)) {
      findings.push({ file: relative, line: index + 1, rule: 'console', description: 'console.* nella libreria (usare Logger)', text: line.trim() });
    }
  });
}

if (findings.length > 0) {
  console.error(`Lint fallito: ${findings.length} violazioni.\n`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} [${finding.rule}] ${finding.description}\n    ${finding.text}`);
  }
  process.exit(1);
}

console.log('Lint OK: nessuna violazione.');
