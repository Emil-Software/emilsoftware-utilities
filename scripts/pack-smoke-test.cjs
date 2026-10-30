// Smoke test del pacchetto pubblicato: crea il tarball con `npm pack`, lo
// installa in un progetto temporaneo e verifica gli entry point da li.
//
// Uso: npm run build && npm run test:pack
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// npm 11 legge `allow-scripts` dalla userconfig: un file vuoto isola il test
// dalla configurazione locale e rende il comando riproducibile in CI.
const cleanNpmrc = path.join(os.tmpdir(), `accessi-pack-smoke-${process.pid}.npmrc`);

function run(command, args, cwd, extra = {}) {
  const env = { ...process.env };
  delete env.npm_config_allow_scripts;
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    ...extra,
  });
}

/** Su Windows non si puo fare spawn di `npm.cmd` senza shell: si usa il cli JS di npm. */
function runNpm(args, cwd) {
  fs.writeFileSync(cleanNpmrc, '');
  const fullArgs = [...args, '--userconfig', cleanNpmrc];
  const npmCli = process.env.npm_execpath;
  if (npmCli && fs.existsSync(npmCli)) {
    return run(process.execPath, [npmCli, ...fullArgs], cwd);
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(npm, fullArgs, cwd, process.platform === 'win32' ? { shell: true } : {});
}

function parsePackOutput(stdout) {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Output di npm pack non riconosciuto:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

if (!fs.existsSync(path.join(root, 'dist', 'index.js'))) {
  throw new Error('dist/ mancante: eseguire `npm run build` prima di `npm run test:pack`.');
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-pack-smoke-'));
const tarballDir = path.join(tempRoot, 'tarball');
const consumerDir = path.join(tempRoot, 'consumer');

try {
  fs.mkdirSync(tarballDir);
  fs.mkdirSync(consumerDir);

  console.log('Pacchetto: npm pack');
  const packResult = parsePackOutput(
    runNpm(['pack', '--json', '--pack-destination', tarballDir, '--loglevel=error'], root),
  );
  const tarballName = packResult[0]?.filename;
  if (!tarballName) throw new Error('npm pack non ha restituito il nome del tarball');
  const tarball = path.join(tarballDir, tarballName);
  console.log(`Tarball: ${tarballName} (${Math.round(fs.statSync(tarball).size / 1024)} KB)`);

  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'accessi-pack-consumer', private: true, version: '1.0.0' }, null, 2),
  );

  console.log('Installazione del tarball in un progetto pulito');
  runNpm(
    ['install', tarball, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'],
    consumerDir,
  );

  const consumerScript = path.join(consumerDir, 'smoke.cjs');
  fs.copyFileSync(path.join(__dirname, 'pack-smoke-consumer.cjs'), consumerScript);

  console.log('Verifica entry point sul pacchetto installato');
  const output = run(process.execPath, ['smoke.cjs'], consumerDir);
  process.stdout.write(output);
} finally {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Su Windows un file puo restare bloccato per qualche istante: la directory
    // temporanea verra comunque ripulita dal sistema.
  }
}
