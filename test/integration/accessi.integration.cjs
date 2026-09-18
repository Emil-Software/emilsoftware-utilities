// Integration test su Firebird reale (vecchie e nuove versioni).
// Se il database non e raggiungibile i test vengono marcati come skip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { getContext } = require('./helpers/accessiTestContext.cjs');
const { Orm } = require('../../src/Orm');
const { AccessiDatabaseUpdater } = require('../../src/accessi-module/database-updates/AccessiDatabaseUpdater');
const { UserService } = require('../../src/accessi-module/Services/UserService/UserService');
const { FiltriService } = require('../../src/accessi-module/Services/FiltriService/FiltriService');
const { PermissionService } = require('../../src/accessi-module/Services/PermissionService/PermissionService');
const { EmailService } = require('../../src/accessi-module/Services/EmailService/EmailService');
const { TwoFactorService } = require('../../src/accessi-module/Services/TwoFactorService/TwoFactorService');
const { AuthService } = require('../../src/accessi-module/Services/AuthService/AuthService');
const { createPasswordResetToken, getAccessiJwtSecret } = require('../../src/accessi-module/security/passwordResetToken');
const { StatoRegistrazione } = require('../../src/accessi-module/Dtos/StatoRegistrazione');

let uniqueCounter = 0;
function uniqueEmail(prefix = 'it') {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}-${Math.random().toString(16).slice(2)}@example.test`;
}

function unavailable(ctx, t) {
  if (process.env.ACCESSI_TEST_REQUIRE_DB === '1') {
    throw new Error(`Firebird richiesto ma non disponibile: ${ctx.reason}`);
  }
  t.skip(`Firebird non disponibile: ${ctx.reason}`);
  return null;
}

async function buildServices(t) {
  const ctx = await getContext();
  if (!ctx.available) {
    return unavailable(ctx, t);
  }

  const options = ctx.options;
  const emailService = new EmailService(options);
  // Evita l'invio SMTP reale: la consegna non e oggetto di questo test.
  emailService.sendTwoFactorCode = async () => {};
  const filtriService = new FiltriService(options);
  const permissionService = new PermissionService(options);
  const twoFactorService = new TwoFactorService(options, emailService);
  const userService = new UserService(options, emailService, permissionService, filtriService);
  const authService = new AuthService(userService, filtriService, options, twoFactorService);

  return { options, userService, filtriService, permissionService, twoFactorService, authService };
}

test('migrazione schema idempotente su Firebird reale', async (t) => {
  const ctx = await getContext();
  if (!ctx.available) {
    return unavailable(ctx, t);
  }

  await AccessiDatabaseUpdater.initialize(ctx.options);
  const versionBefore = await AccessiDatabaseUpdater.getCurrentVersion(ctx.options);
  await AccessiDatabaseUpdater.initialize(ctx.options);
  const versionAfter = await AccessiDatabaseUpdater.getCurrentVersion(ctx.options);

  assert.ok(versionBefore, 'la versione database deve essere valorizzata dopo la migrazione');
  assert.equal(versionAfter, versionBefore);
});

test('registrazione, password e login funzionano su DB reale', async (t) => {
  const services = await buildServices(t);
  if (!services) return;

  const email = uniqueEmail('login');
  const codiceUtente = await services.userService.register(
    { email, nome: 'Int', cognome: 'Test' },
    { initialState: StatoRegistrazione.CONF },
  );
  assert.ok(codiceUtente > 0);

  await services.authService.setPassword(codiceUtente, 'Password-123');
  const login = await services.authService.login({ email, password: 'Password-123' });
  assert.ok(login.utente);

  const token = services.authService.createAccessiToken(login.utente, ['password']);
  const payload = await services.authService.getAuthenticatedTokenPayload(token.value);
  assert.equal(Number(payload.codiceUtente), codiceUtente);
});

test('grant singolo e batch coincidono su DB reale', async (t) => {
  const services = await buildServices(t);
  if (!services) return;

  const db = services.options.databaseOptions;
  await Orm.execute(db, `UPDATE OR INSERT INTO MENU_GRP (CODGRP, DESGRP, FLGENABLED) VALUES (?, ?, ?) MATCHING (CODGRP)`, ['Z', 'Integration', 1]);
  await Orm.execute(db, `UPDATE OR INSERT INTO MENU (CODMNU, DESMNU, CODGRP, FLGENABLED) VALUES (?, ?, ?, ?) MATCHING (CODMNU)`, ['ITMENU', 'Integration Menu', 'Z', 1]);

  const email = uniqueEmail('grant');
  const codiceUtente = await services.userService.register(
    { email, nome: 'Grant', cognome: 'Batch' },
    { initialState: StatoRegistrazione.CONF },
  );

  const roleDescription = `ITROLE-${codiceUtente}`;
  await services.permissionService.updateOrInsertRole({
    descrizioneRuolo: roleDescription,
    menu: [{ codiceMenu: 'ITMENU', tipoAbilitazione: 30 }],
  });

  const roles = await services.permissionService.getRolesWithMenus();
  const role = roles.find((item) => item.descrizioneRuolo === roleDescription);
  assert.ok(role, 'ruolo appena creato non trovato');

  await services.permissionService.assignRolesToUser(codiceUtente, [role.codiceRuolo]);

  const single = await services.permissionService.getUserRolesAndGrants(codiceUtente);
  const batched = (await services.permissionService.getUsersRolesAndGrants([codiceUtente])).get(codiceUtente);

  assert.deepEqual(batched.grants, single.grants);
  assert.deepEqual(batched.ruoli, single.ruoli);
});

test('reset password: nonce monouso verificato su DB reale', async (t) => {
  const services = await buildServices(t);
  if (!services) return;

  const email = uniqueEmail('reset');
  const codiceUtente = await services.userService.register(
    { email, nome: 'Reset', cognome: 'Nonce' },
    { initialState: StatoRegistrazione.CONF },
  );
  await services.authService.setPassword(codiceUtente, 'OldPassword-1');

  const nonce = randomUUID();
  await Orm.execute(services.options.databaseOptions, 'UPDATE UTENTI SET KEYREG = ? WHERE CODUTE = ?', [nonce, codiceUtente]);
  const token = createPasswordResetToken(codiceUtente, nonce, getAccessiJwtSecret(services.options));

  await services.authService.confirmResetPassword(token, 'NewPassword-2');
  const login = await services.authService.login({ email, password: 'NewPassword-2' });
  assert.ok(login.utente);

  // Il secondo uso dello stesso token deve fallire (nonce consumato).
  await assert.rejects(() => services.authService.confirmResetPassword(token, 'AnotherPass-3'));
});

test('2FA: challenge emessa e codice errato rifiutato su DB reale', async (t) => {
  const services = await buildServices(t);
  if (!services) return;

  const email = uniqueEmail('twofactor');
  const codiceUtente = await services.userService.register(
    { email, nome: 'Two', cognome: 'Factor' },
    { initialState: StatoRegistrazione.CONF },
  );

  const challenge = await services.twoFactorService.issue({ codiceUtente, email, mode: 'password' });
  assert.match(challenge.challengeId, /^[a-f0-9]{64}$/);

  const proof = await services.twoFactorService.describe(challenge.challengeId);
  assert.equal(proof.codiceUtente, codiceUtente);

  await assert.rejects(() => services.twoFactorService.consume(challenge.challengeId, '000000'));
});
