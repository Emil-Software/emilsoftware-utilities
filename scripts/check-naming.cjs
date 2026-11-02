// Controllo naming e pulizia del repository.
//
// Usa `git ls-files`, quindi considera solo cio che verrebbe pubblicato e
// ignora dist/, node_modules/ e gli altri path in .gitignore.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const KEBAB_DIR = /^[a-z0-9][a-z0-9-]*$/;
const KEBAB_FILE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const PASCAL_OR_CAMEL = /^[A-Za-z][A-Za-z0-9]*$/;
const ROOT_EXCEPTIONS = new Set([
  'README.md',
  'CHANGELOG.md',
  'WIKI.md',
  'WIKI.ai.md',
  'LICENSE',
  'SECURITY.md',
]);
const KEBAB_EXCEPTIONS = new Set([
  'README.md',
  'CHANGELOG.md',
  'WIKI.md',
  'WIKI.ai.md',
  'index.ts',
  'accessi-tenant@.service',
]);
const SRC_EXCEPTIONS = new Set([
  'index.ts',
  'md.d.ts',
  'README.md',
]);
const GENERATED = /(^|\/)(generated)(\/|$)/;
const SQL_MIGRATION = /^V\d+\.\d+\.\d+_(to_V\d+\.\d+\.\d+|[a-z0-9_]+)\.sql$/;
const ASSET_EXTENSION = /\.(html|css|js|mjs)$/i;
const FORBIDDEN_SEGMENTS = new Set(['.DS_Store', '.idea', 'logs']);
const FORBIDDEN_EXTENSIONS = new Set(['.tsbuildinfo', '.tgz', '.log']);

function trackedFiles(root = ROOT) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean);
}

function stripKnownExtension(file) {
  if (file.endsWith('.d.ts')) return file.slice(0, -5);
  return file.replace(/\.(ts|tsx|js|cjs|mjs|json|md|html|css|yml|yaml|sql|service|example)$/i, '');
}

function checkNaming(root = ROOT) {
  const issues = [];
  for (const file of trackedFiles(root)) {
    const segments = file.split('/');
    for (const segment of segments) {
      if (FORBIDDEN_SEGMENTS.has(segment)) issues.push(`path vietato: ${file}`);
      if (segment === '.idea') issues.push(`IDE nel repository: ${file}`);
    }
    const lower = file.toLowerCase();
    for (const extension of FORBIDDEN_EXTENSIONS) {
      if (lower.endsWith(extension)) issues.push(`artefatto locale tracciato: ${file}`);
    }

    for (const directory of segments.slice(0, -1)) {
      if (directory.startsWith('.')) continue;
      if (!KEBAB_DIR.test(directory)) issues.push(`cartella non kebab-case: ${file}`);
    }

    const base = path.posix.basename(file);
    if (segments.length === 1) {
      if (base.startsWith('.')) continue;
      if (ROOT_EXCEPTIONS.has(base)) continue;
      if (!KEBAB_FILE.test(stripKnownExtension(base))) issues.push(`file root fuori standard: ${file}`);
      continue;
    }

    if (file.startsWith('src/')) {
      if (GENERATED.test(file) || SQL_MIGRATION.test(base)) continue;
      if (SRC_EXCEPTIONS.has(base)) continue;
      if (base.endsWith('.d.ts')) {
        if (!PASCAL_OR_CAMEL.test(stripKnownExtension(base))) issues.push(`dichiarazione fuori standard: ${file}`);
        continue;
      }
      if (base.endsWith('.md') || ASSET_EXTENSION.test(base)) {
        if (!KEBAB_FILE.test(stripKnownExtension(base))) issues.push(`file src fuori standard: ${file}`);
        continue;
      }
      if (!PASCAL_OR_CAMEL.test(stripKnownExtension(base))) issues.push(`file src fuori standard: ${file}`);
      continue;
    }

    if (file.startsWith('scripts/') || file.startsWith('test/') || file.startsWith('docs/') || file.startsWith('deploy/')) {
      if (base.startsWith('.')) continue;
      if (KEBAB_EXCEPTIONS.has(base)) continue;
      if (!KEBAB_FILE.test(stripKnownExtension(base))) issues.push(`file fuori standard: ${file}`);
    }
  }
  return issues;
}

if (require.main === module) {
  const issues = checkNaming();
  if (issues.length > 0) {
    console.error(`Naming non valido:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Naming OK: file e cartelle rispettano docs/conventions.md.');
}

module.exports = { checkNaming, trackedFiles };
