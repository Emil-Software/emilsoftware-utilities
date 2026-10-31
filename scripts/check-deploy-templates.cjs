// Controllo statico dei template di deployment multi-tenant.
//
// Non valida la sintassi di Nginx/Traefik (non vogliamo dipendenze), ma
// impedisce regressioni: file mancanti, segreti accidentalmente committati e
// riferimenti al servizio tenant sbagliato.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const REQUIRED = [
  'deploy/README.md',
  'deploy/systemd/accessi-tenant@.service',
  'deploy/systemd/tenant.secrets.example',
  'deploy/docker/docker-compose.yml',
  'deploy/nginx/accessi-tenants.conf',
  'deploy/traefik/dynamic.yml',
];

const REQUIRED_CONTENT = {
  'deploy/systemd/accessi-tenant@.service': [
    'ACCESSI_TENANT_ENVIRONMENT',
    'startAccessiTenantService.js',
    'EnvironmentFile',
    'Restart=on-failure',
    'NoNewPrivileges=true',
  ],
  'deploy/docker/docker-compose.yml': [
    'ACCESSI_TENANT_ENVIRONMENT',
    'healthcheck',
    'read_only',
    'env_file',
    'accessi-acme',
    'accessi-beta',
  ],
  'deploy/nginx/accessi-tenants.conf': [
    'map $host',
    'proxy_pass',
    'X-Forwarded-For',
    'X-Forwarded-Proto',
  ],
  'deploy/traefik/dynamic.yml': [
    'Host(`',
    'healthCheck',
    'loadBalancer',
    'accessi-acme',
    'accessi-beta',
  ],
  'deploy/README.md': [
    'docs/multi-tenancy.md',
    'check:deploy',
    'ACCESSI_TENANT_ENVIRONMENT',
  ],
};

function checkDeployTemplates(root = ROOT) {
  const issues = [];
  for (const relative of REQUIRED) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      issues.push(`file mancante: ${relative}`);
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    if (content.trim() === '') issues.push(`file vuoto: ${relative}`);
    for (const expected of REQUIRED_CONTENT[relative] ?? []) {
      if (!content.includes(expected)) issues.push(`${relative}: manca "${expected}"`);
    }
  }

  for (const relative of REQUIRED) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) {
      issues.push(`${relative}: contiene una chiave privata`);
    }
    if (/(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*[:=]\s*(?!<|\$|""|'')/i.test(content)) {
      // I file di esempio usano placeholder <...>; un valore letterale e sospetto.
      const suspicious = content
        .split(/\r?\n/)
        .filter((line) => /(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*[:=]\s*(?!<|\$|""|'')/i.test(line))
        .filter((line) => !line.trim().startsWith('#'));
      for (const line of suspicious) {
        issues.push(`${relative}: possibile segreto in chiaro: ${line.trim().slice(0, 80)}`);
      }
    }
  }

  return issues;
}

if (require.main === module) {
  const issues = checkDeployTemplates();
  if (issues.length > 0) {
    console.error(`Template deploy non validi:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Deploy OK: ${REQUIRED.length} template verificati.`);
}

module.exports = { checkDeployTemplates, REQUIRED };
