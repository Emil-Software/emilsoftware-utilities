// Crea (o aggiorna) un superuser Accessi nel database di test, per provare la console.
// Default: DB Firebird 5 dei container di test (porta 3055). Override con ACCESSI_TEST_DB_* e SEED_ADMIN_*.
process.env.ACCESSI_TEST_DB_HOST = process.env.ACCESSI_TEST_DB_HOST || '127.0.0.1';
process.env.ACCESSI_TEST_DB_PORT = process.env.ACCESSI_TEST_DB_PORT || '3055';
process.env.ACCESSI_TEST_DB_DATABASE = process.env.ACCESSI_TEST_DB_DATABASE || '/var/lib/firebird/data/test_accessi.fdb';
process.env.ACCESSI_TEST_DB_USER = process.env.ACCESSI_TEST_DB_USER || 'SYSDBA';
process.env.ACCESSI_TEST_DB_PASSWORD = process.env.ACCESSI_TEST_DB_PASSWORD || 'masterkey';
process.env.ACCESSI_TEST_REQUIRE_DB = '1';

require('ts-node/register/transpile-only');
require('reflect-metadata');

const { getContext } = require('../test/integration/helpers/accessiTestContext.cjs');
const { Orm } = require('../src/Orm');
const { UserService } = require('../src/accessi-module/Services/UserService/UserService');
const { FiltriService } = require('../src/accessi-module/Services/FiltriService/FiltriService');
const { PermissionService } = require('../src/accessi-module/Services/PermissionService/PermissionService');
const { EmailService } = require('../src/accessi-module/Services/EmailService/EmailService');
const { TwoFactorService } = require('../src/accessi-module/Services/TwoFactorService/TwoFactorService');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { StatoRegistrazione } = require('../src/accessi-module/Dtos/StatoRegistrazione');

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.test').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin-12345';

  const ctx = await getContext();
  if (!ctx.available) {
    console.error('Database non disponibile:', ctx.reason);
    process.exit(1);
  }

  const options = ctx.options;
  const emailService = new EmailService(options);
  emailService.sendTwoFactorCode = async () => {};
  const filtriService = new FiltriService(options);
  const permissionService = new PermissionService(options);
  const twoFactorService = new TwoFactorService(options, emailService);
  const userService = new UserService(options, emailService, permissionService, filtriService);
  const authService = new AuthService(userService, filtriService, options, twoFactorService);

  let codiceUtente;
  try {
    codiceUtente = await userService.register(
      { email, nome: 'Admin', cognome: 'Console', flagSuper: true },
      { allowPrivilegedFields: true, initialState: StatoRegistrazione.CONF },
    );
    console.log('Superuser creato.');
  } catch (error) {
    const existing = await userService.getCodiceUtenteByEmail(email).catch(() => undefined);
    codiceUtente = existing?.codiceUtente;
    if (!codiceUtente) {
      console.error('Impossibile creare o trovare il superuser:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    await Orm.execute(options.databaseOptions, 'UPDATE UTENTI_CONFIG SET FLGSUPER = 1, FLGADMINCONFIG = 1 WHERE CODUTE = ?', [codiceUtente]);
    await Orm.execute(options.databaseOptions, 'UPDATE UTENTI SET STAREG = ? WHERE CODUTE = ?', [StatoRegistrazione.CONF, codiceUtente]);
    console.log('Superuser esistente aggiornato.');
  }

  await authService.setPassword(codiceUtente, password);

  console.log('---');
  console.log('Credenziali console Accessi:');
  console.log('  email:   ', email);
  console.log('  password:', password);
}

main()
  .then(() => Orm.closePools())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    await Orm.closePools().catch(() => undefined);
    process.exit(1);
  });
