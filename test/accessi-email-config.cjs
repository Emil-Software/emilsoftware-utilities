require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Orm } = require('../src/Orm');
const { CryptUtilities, PasswordUtilities } = require('../src/Utilities');
const { AccessiModule } = require('../src/accessi-module/AccessiModule');
const { UserService } = require('../src/accessi-module/services/user-service/UserService');
const { EmailService } = require('../src/accessi-module/services/email-service/EmailService');
const {
  isEmailConfigured,
  assertEmailConfigured,
  AccessiEmailNotConfiguredError,
  ACCESSI_EMAIL_NOT_CONFIGURED,
} = require('../src/accessi-module/security/emailConfiguration');

const validEmail = () => ({
  host: 'localhost',
  port: 25,
  secure: false,
  requireTLS: false,
  tls: { rejectUnauthorized: false },
  from: 'noreply@example.test',
  auth: { user: 'u', pass: 'p' },
});
const options = (emailOptions) => ({
  databaseOptions: {},
  confirmationEmailUrl: 'http://example.test',
  confirmationEmailReturnUrl: 'http://example.test',
  encryptionKey: '0123456789ABCDEF',
  mockDemoUser: false,
  jwtOptions: { secret: 'email-config-test', expiresIn: '1h' },
  emailOptions,
});

test('isEmailConfigured riconosce configurazioni valide e non', () => {
  assert.equal(isEmailConfigured(options(validEmail())), true);
  assert.equal(isEmailConfigured(options({})), false);
  assert.equal(isEmailConfigured(options({ host: 'smtp', from: '   ' })), false);
});

test('assertEmailConfigured solleva ACCESSI_EMAIL_NOT_CONFIGURED con status 400', () => {
  assert.throws(() => assertEmailConfigured(options({})), (error) => {
    assert.ok(error instanceof AccessiEmailNotConfiguredError);
    assert.equal(error.code, ACCESSI_EMAIL_NOT_CONFIGURED);
    assert.equal(error.getStatus(), 400);
    return true;
  });
});

test('AccessiModule.forRoot richiede emailOptions', () => {
  assert.throws(() => AccessiModule.forRoot(options({})), (error) => error.code === ACCESSI_EMAIL_NOT_CONFIGURED);
  assert.doesNotThrow(() => AccessiModule.forRoot(options(validEmail())));
});

test('EmailService rifiuta reset e 2FA senza email configurata', async () => {
  const service = new EmailService(options({}));
  await assert.rejects(service.sendPasswordResetEmail('utente@example.test'), (error) => error.code === ACCESSI_EMAIL_NOT_CONFIGURED);
  await assert.rejects(service.sendTwoFactorCode('utente@example.test', '123456', 10), (error) => error.code === ACCESSI_EMAIL_NOT_CONFIGURED);
});

test('UserService.forcePasswordReset richiede email e invia quando configurata', async () => {
  const notConfigured = new UserService(options({}), new EmailService(options({})), {}, {});
  await assert.rejects(notConfigured.forcePasswordReset(1), (error) => error.code === ACCESSI_EMAIL_NOT_CONFIGURED);

  const sent = [];
  const emailService = { sendPasswordResetEmail: async (email) => { sent.push(email); } };
  const configured = new UserService(options(validEmail()), emailService, {}, {});
  configured.getUsers = async () => [{ utente: { email: 'utente@example.test' } }];
  await configured.forcePasswordReset(7);
  assert.deepEqual(sent, ['utente@example.test']);

  const missing = new UserService(options(validEmail()), emailService, {}, {});
  missing.getUsers = async () => [];
  await assert.rejects(missing.forcePasswordReset(8), /Nessun utente/);
});

test('UserService.forcePasswordResetForLegacyPasswords contatta solo password non moderne', async () => {
  const sent = [];
  const emailService = { sendPasswordResetEmail: async (email) => { sent.push(email); } };
  const userService = new UserService(options(validEmail()), emailService, {}, {});
  const original = Orm.query;
  Orm.query = async (_options, sql) => {
    assert.match(sql, /NOT STARTING WITH 'scrypt\$/);
    return [{ codice_utente: 1, email: 'a@example.test' }, { codice_utente: 2, email: 'b@example.test' }, { codice_utente: 3, email: '' }];
  };
  try {
    const count = await userService.forcePasswordResetForLegacyPasswords();
    assert.equal(count, 2);
    assert.deepEqual(sent, ['a@example.test', 'b@example.test']);
  } finally {
    Orm.query = original;
  }

  const notConfigured = new UserService(options({}), emailService, {}, {});
  await assert.rejects(notConfigured.forcePasswordResetForLegacyPasswords(), (error) => error.code === ACCESSI_EMAIL_NOT_CONFIGURED);
});

test('una password legacy e verificabile SOLO con la encryptionKey storica', () => {
  const plain = 'Segreta-123';
  const oldKey = '0123456789ABCDEF';
  const storedScryptLegacy = PasswordUtilities.hashLegacyEncryptedPassword(CryptUtilities.encrypt(plain, oldKey));

  assert.equal(
    PasswordUtilities.verifyLegacyEncryptedPassword(CryptUtilities.encrypt(plain, oldKey), storedScryptLegacy),
    true,
  );
  assert.equal(
    PasswordUtilities.verifyLegacyEncryptedPassword(CryptUtilities.encrypt(plain, 'FEDCBA0987654321'), storedScryptLegacy),
    false,
  );
});
