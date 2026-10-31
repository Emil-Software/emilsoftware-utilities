require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkDeployTemplates, REQUIRED } = require('../scripts/check-deploy-templates.cjs');

test('#24: i template di deployment sono presenti e coerenti', () => {
  assert.deepEqual(checkDeployTemplates(), []);
  assert.ok(REQUIRED.includes('deploy/systemd/accessi-tenant@.service'));
  assert.ok(REQUIRED.includes('deploy/docker/docker-compose.yml'));
});

test('#24: il controllo rileva un segreto in chiaro', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-deploy-check-'));
  try {
    for (const relative of REQUIRED) {
      const file = path.join(directory, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'placeholder');
    }
    fs.writeFileSync(path.join(directory, 'deploy/README.md'), 'PASSWORD=segreto-vero');
    const issues = checkDeployTemplates(directory);
    assert.ok(issues.some((issue) => /possibile segreto/.test(issue)));
    assert.ok(issues.some((issue) => /manca/.test(issue)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
