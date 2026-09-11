import 'dotenv/config';
import express from 'express';
import { AccessiOptions, initializeAccessiModule } from 'emilsoftware-utilities';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile obbligatoria mancante: ${name}`);
  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : ['true', '1', 'yes'].includes(value.toLowerCase());
}

function optionalNumber(name: string): number | undefined {
  const value = process.env[name];
  return value ? Number(value) : undefined;
}

async function main(): Promise<void> {
  if ((process.env.API_PREFIX ?? 'api') !== 'api') {
    throw new Error('Questo esempio usa il prefisso fisso /api previsto da initializeAccessiModule.');
  }

  const options: AccessiOptions = {
    databaseOptions: {
      host: required('ACCESSI_FIREBIRD_HOST'),
      port: Number(process.env.ACCESSI_FIREBIRD_PORT ?? 3050),
      database: required('ACCESSI_FIREBIRD_DATABASE'),
      user: required('ACCESSI_FIREBIRD_USER'),
      password: required('ACCESSI_FIREBIRD_PASSWORD'),
      wireCrypt: optionalNumber('ACCESSI_FIREBIRD_WIRE_CRYPT'),
    },
    encryptionKey: required('ACCESSI_ENCRYPTION_KEY'),
    jwtOptions: { secret: required('ACCESSI_JWT_SECRET'), expiresIn: process.env.ACCESSI_JWT_EXPIRES ?? '24h' },
    autoUpdateDatabase: booleanValue('ACCESSI_AUTO_UPDATE_DATABASE', false),
    legacyPasswordMigrationOnStartup: booleanValue('ACCESSI_LEGACY_PASSWORD_MIGRATION_ON_STARTUP', true),
    passwordExpiration: booleanValue('ACCESSI_PASSWORD_EXPIRATION', false),
    passwordExpirationDays: optionalNumber('ACCESSI_PASSWORD_EXPIRATION_DAYS'),
    mockDemoUser: booleanValue('ACCESSI_MOCK_DEMO_USER', false),
    confirmationEmailUrl: required('ACCESSI_CONFIRMATION_EMAIL_URL'),
    confirmationEmailReturnUrl: required('ACCESSI_CONFIRMATION_RETURN_EMAIL_URL'),
    customResetPage: process.env.ACCESSI_CUSTOM_RESET_PAGE || undefined,
    confirmationEmailPrefix: process.env.ACCESSI_CONFIRMATION_EMAIL_PREFIX || undefined,
    publicAuthRateLimit: { enabled: booleanValue('ACCESSI_PUBLIC_RATE_LIMIT_ENABLED', true) },
    publicRegistration: { enabled: false },
    federatedAuthentication: {
      enabled: booleanValue('ACCESSI_FEDERATED_ENABLED', false),
      autoUpdateSchema: booleanValue('ACCESSI_FEDERATED_AUTO_UPDATE_SCHEMA', false),
      allowSelfRegistration: booleanValue('ACCESSI_FEDERATED_ALLOW_SELF_REGISTRATION', false),
    },
    emailOptions: {
      host: required('ACCESSI_EMAIL_HOST'),
      port: Number(process.env.ACCESSI_EMAIL_PORT ?? 465),
      secure: booleanValue('ACCESSI_EMAIL_SECURE', true),
      requireTLS: booleanValue('ACCESSI_EMAIL_REQUIRE_TLS', true),
      tls: { rejectUnauthorized: booleanValue('ACCESSI_EMAIL_TLS_REJECT_UNAUTHORIZED', true) },
      from: required('ACCESSI_EMAIL_FROM'),
      auth: { user: required('ACCESSI_EMAIL_USER'), pass: required('ACCESSI_EMAIL_PASSWORD') },
    },
  };

  const app = express();
  if (process.env.ACCESSI_FIREBIRD_AUTH_PLUGIN) {
    console.warn('ACCESSI_FIREBIRD_AUTH_PLUGIN non e supportato dalla versione node-firebird usata dalla libreria e viene ignorato.');
  }
  // Nest configura il proprio parser JSON: non registrarne uno prima, altrimenti
  // i parse error bypassano il contratto di errore del modulo Accessi.
  await initializeAccessiModule(app, options);

  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, () => {
    console.log(`Accessi console: http://localhost:${port}/api/accessi/console`);
    console.log(`Accessi Swagger: http://localhost:${port}/accessi/swagger`);
  });
}

void main();
