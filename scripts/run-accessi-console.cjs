// Avvia il backend di esempio (test/accessi-example) puntandolo al Firebird di test,
// così da aprire la console Accessi servita dalla libreria.
// Override DB/porta con ACCESSI_FIREBIRD_* oppure PORT.
const { spawn } = require('node:child_process');
const path = require('node:path');

const exampleDir = path.join(__dirname, '..', 'test', 'accessi-example');

const env = {
  ...process.env,
  PORT: process.env.PORT || '3001',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ACCESSI_FIREBIRD_HOST: process.env.ACCESSI_FIREBIRD_HOST || '127.0.0.1',
  ACCESSI_FIREBIRD_PORT: process.env.ACCESSI_FIREBIRD_PORT || '3055',
  ACCESSI_FIREBIRD_DATABASE: process.env.ACCESSI_FIREBIRD_DATABASE || '/var/lib/firebird/data/test_accessi.fdb',
  ACCESSI_FIREBIRD_USER: process.env.ACCESSI_FIREBIRD_USER || 'SYSDBA',
  ACCESSI_FIREBIRD_PASSWORD: process.env.ACCESSI_FIREBIRD_PASSWORD || 'masterkey',
  ACCESSI_AUTO_UPDATE_DATABASE: 'true',
  ACCESSI_LEGACY_PASSWORD_MIGRATION_ON_STARTUP: process.env.ACCESSI_LEGACY_PASSWORD_MIGRATION_ON_STARTUP || 'false',
  ACCESSI_MOCK_DEMO_USER: 'false',
};

console.log(`Avvio backend di esempio su porta ${env.PORT} (DB ${env.ACCESSI_FIREBIRD_HOST}:${env.ACCESSI_FIREBIRD_PORT}).`);
const child = spawn('npm', ['start'], { cwd: exampleDir, stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
