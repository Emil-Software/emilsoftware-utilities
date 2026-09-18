require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Orm } = require('../src/Orm');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { createPasswordResetToken } = require('../src/accessi-module/security/passwordResetToken');
const options = { databaseOptions: {}, jwtOptions: { secret: 'test-reset-secret' } };

for (const scenario of ['success', 'used', 'write-fails']) {
  test(`password reset transaction: ${scenario}`, async t => {
    const calls = [];
    const transaction = { query(sql, params, callback) {
      calls.push(sql);
      if (sql.includes('RETURNING')) return callback(null, { CODUTE: scenario === 'used' ? null : 1 });
      callback(scenario === 'write-fails' ? new Error('write failed') : null, []);
    } };
    t.mock.method(Orm, 'connect', async () => ({ detach(callback) { calls.push('detach'); callback(); } }));
    t.mock.method(Orm, 'startTransaction', async () => transaction);
    t.mock.method(Orm, 'commitTransaction', async () => { calls.push('commit'); });
    t.mock.method(Orm, 'rollbackTransaction', async () => { calls.push('rollback'); });
    const service = new AuthService({}, {}, options);
    const token = createPasswordResetToken(1, 'nonce', options.jwtOptions.secret);
    const operation = service.confirmResetPassword(token, 'Password-123');
    if (scenario === 'success') await operation;
    else await assert.rejects(operation);
    assert.equal(calls.includes('commit'), scenario === 'success');
    assert.equal(calls.includes('rollback'), scenario !== 'success');
    assert.equal(calls.at(-1), 'detach');
    if (scenario === 'used') assert.ok(!calls.some(sql => sql.includes('UTENTI_PWD')));
  });
}
