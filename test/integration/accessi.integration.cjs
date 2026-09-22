// Integration test su Firebird reale (vecchie e nuove versioni).
// Se il database non e raggiungibile i test vengono marcati come skip.
const { test, after } = require('node:test');
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
const { ServiceTokenService } = require('../../src/accessi-module/Services/ServiceTokenService/ServiceTokenService');
const { StatoRegistrazione } = require('../../src/accessi-module/Dtos/StatoRegistrazione');

// Il pool e attivo di default: chiudilo a fine suite per permettere l'uscita del processo.
after(async () => { await Orm.closePools(); });

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
  const token = createPasswordResetToken(codiceUtente, nonce, getAccessiJwtSecret(services.options, 'reset'));

  await services.authService.confirmResetPassword(token, 'NewPassword-2');
  const login = await services.authService.login({ email, password: 'NewPassword-2' });
  assert.ok(login.utente);

  // Il secondo uso dello stesso token deve fallire (nonce consumato).
  await assert.rejects(() => services.authService.confirmResetPassword(token, 'AnotherPass-3'));
});

test('service token: issue, verify, list, revoke e rotate su DB reale', async (t) => {
  const services = await buildServices(t);
  if (!services) return;

  const serviceTokens = new ServiceTokenService(services.options);
  const issued = await serviceTokens.issue({ label: `IT-${Date.now()}`, scopes: ['ia', 'chat'], ttlDays: 1 });
  assert.match(issued.token, /^st_[a-f0-9]{32}\./);
  assert.deepEqual(issued.scopes, ['ia', 'chat']);

  const verified = await serviceTokens.verify(issued.token, { ip: '10.0.0.1' });
  assert.equal(verified.tokenId, issued.tokenId);
  assert.deepEqual(verified.scopes, ['ia', 'chat']);

  // Segreto errato con lo stesso identificativo: rifiutato.
  assert.equal(await serviceTokens.verify(`${issued.tokenId}.${'x'.repeat(43)}`), undefined);

  const listed = await serviceTokens.list();
  const listedToken = listed.find((token) => token.tokenId === issued.tokenId);
  assert.ok(listedToken && listedToken.revoked === false);
  assert.equal(listedToken.lastUsedIp, '10.0.0.1', 'audit IP registrato su DB reale');

  await serviceTokens.revoke(issued.tokenId);
  assert.equal(await serviceTokens.verify(issued.token), undefined);

  const rotated = await serviceTokens.rotate(issued.tokenId);
  assert.notEqual(rotated.tokenId, issued.tokenId);
  assert.deepEqual(rotated.scopes, ['ia', 'chat']);
  assert.equal((await serviceTokens.verify(rotated.token))?.tokenId, rotated.tokenId);

  await serviceTokens.revoke(rotated.tokenId);
});

test('getUsers supporta la paginazione (limit/offset) su DB reale', async (t) => {
  const services = await buildServices(t);
  if (!services) return;

  for (let index = 0; index < 3; index += 1) {
    await services.userService.register(
      { email: uniqueEmail('page'), nome: 'Page', cognome: 'Test' },
      { initialState: StatoRegistrazione.CONF },
    );
  }

  const page1 = await services.userService.getUsers({ limit: 2, offset: 0 });
  const page2 = await services.userService.getUsers({ limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.ok(page2.length >= 1);

  const firstPageIds = new Set(page1.map((row) => row.utente?.codiceUtente));
  assert.ok(page2.every((row) => !firstPageIds.has(row.utente?.codiceUtente)), 'le pagine non devono sovrapporsi');
});

test('pool di connessioni opzionale funziona su DB reale', async (t) => {
  const ctx = await getContext();
  if (!ctx.available) return unavailable(ctx, t);

  const pooledOptions = {
    ...ctx.options,
    databaseOptions: { ...ctx.options.databaseOptions, poolSize: 2 },
  };

  try {
    const rows = await Orm.query(pooledOptions.databaseOptions, 'SELECT 1 AS ONE FROM RDB$DATABASE');
    assert.equal(Number(rows[0]?.ONE), 1);

    // La transazione acquisisce/rilascia dal pool senza perdere atomicita.
    await Orm.withTransaction(pooledOptions.databaseOptions, async (transaction) => {
      const inner = await Orm.transactionQuery(transaction, 'SELECT 1 AS ONE FROM RDB$DATABASE');
      assert.equal(Number(Array.isArray(inner) ? inner[0]?.ONE : undefined), 1);
    });

    // Il pool resta utilizzabile dopo la transazione.
    const after = await Orm.query(pooledOptions.databaseOptions, 'SELECT 2 AS TWO FROM RDB$DATABASE');
    assert.equal(Number(after[0]?.TWO), 2);
  } finally {
    // I pool mantengono connessioni/timer: vanno chiusi a fine test.
    await Orm.closePools();
  }
});

test('migrazione ripartibile: una tabella mancante viene ricreata', async (t) => {
  const ctx = await getContext();
  if (!ctx.available) return unavailable(ctx, t);

  await Orm.execute(ctx.options.databaseOptions, 'DROP TABLE ACCESSI_SERVICE_TOKEN');
  await AccessiDatabaseUpdater.initialize(ctx.options);

  const rows = await Orm.query(
    ctx.options.databaseOptions,
    `SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'ACCESSI_SERVICE_TOKEN'`,
  );
  assert.equal(rows.length, 1, 'la tabella deve essere ricreata rieseguendo la migrazione');
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
