import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { AccessiModule, AccessiOptions } from '../accessi-module/AccessiModule';

/**
 * Esporta il contratto OpenAPI dai decorator Nest senza avviare il database.
 * Il file risultante e l'unica sorgente per il client Orval della console.
 */
async function generateAccessiOpenApi(): Promise<void> {
  const options: AccessiOptions = {
    databaseOptions: { host: 'openapi-generation', database: 'not-used', user: 'not-used' },
    confirmationEmailUrl: 'https://invalid.local',
    confirmationEmailReturnUrl: 'https://invalid.local',
    encryptionKey: 'openapi-generation-only',
    mockDemoUser: false,
    autoUpdateDatabase: false,
    legacyPasswordMigrationOnStartup: false,
    jwtOptions: { secret: 'openapi-generation-only', expiresIn: '1h' },
    emailOptions: {
      host: 'localhost', port: 25, secure: false, requireTLS: false,
      tls: { rejectUnauthorized: true }, from: 'openapi@invalid.local', auth: { user: '', pass: '' },
    },
    federatedAuthentication: { enabled: false },
  };

  const app = await NestFactory.create(
    AccessiModule.forRoot(options),
    new ExpressAdapter(express()),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  await app.init();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Accessi API').setVersion('1.0').addBearerAuth().build(),
  );
  const outputDirectory = join(process.cwd(), 'src', 'accessi-module', 'openapi');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'accessi.openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

generateAccessiOpenApi().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
