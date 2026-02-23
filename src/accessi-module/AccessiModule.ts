/**
 * Modulo che gestisce le operazioni di accesso degli utenti, incluse le rotte, il controller e il modello.
 *
 * @module AccessiModule
 * @author mttdev382
 */
import { Options } from 'es-node-firebird';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { AuthService } from './Services/AuthService/AuthService';
import { EmailService } from './Services/EmailService/EmailService';
import { PermissionService } from './Services/PermissionService/PermissionService';
import { UserService } from './Services/UserService/UserService';
import { EmailController } from './Controllers/EmailController';
import { AuthController } from './Controllers/AuthController';
import { PermissionController } from './Controllers/PermissionController';
import { UserController } from './Controllers/UserController';
import { FiltriService } from './Services/FiltriService/FiltriService';
import { FiltriController } from './Controllers/FiltriController';
import { ConfiguratorController } from './Controllers/ConfiguratorController';
import { ConfiguratorService } from './Services/ConfiguratorService/ConfiguratorService';
import { JwtSimpleGuard } from './jwt/jwt.strategy';
import { AuthenticateGenService } from './middleware/authenticateGen';

export interface JwtOptions {
  secret: string;
  expiresIn: string;
}

export interface EmailOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS : boolean;
  tls: {
    rejectUnauthorized: boolean,
  }
  from: string;
  auth: {
    user: string;
    pass: string;
  };
}

export interface ExtensionFieldsOptions {
  databaseOptions: Options;
  objectKey: string;
  tableName: string;
  tableFields: string[];
  tableJoinFieldName: string;
}

export interface AccessiOptions {
  databaseOptions: Options;
  /**
   * Basepath del sito es: 'http://www.il-mio-sito.it/nome-progetto(se c'è)'
   */
  confirmationEmailUrl: string;
  /**
   * Percorso della pagina di reset personalizzata es. http://localhost:4200/#/admin/reset-password
   * N.B si sostituisce al confirmationMailURl
   */
  customResetPage?: string;
  confirmationEmailReturnUrl: string;
  confirmationEmailPrefix?: string;
  encryptionKey: string;
  mockDemoUser: boolean;
  passwordExpiration?: boolean;
  jwtOptions: JwtOptions;
  emailOptions: EmailOptions;
  extensionFieldsOptions?: ExtensionFieldsOptions[];
}

@Global()
@Module({
  controllers: [
    EmailController,
    AuthController,
    PermissionController,
    UserController,
    FiltriController,
    ConfiguratorController
  ],
  providers: [AuthService, UserService, EmailService, PermissionService, FiltriService, ConfiguratorService, JwtSimpleGuard, AuthenticateGenService],
  exports: [AuthService, UserService, EmailService, PermissionService, FiltriService, ConfiguratorService, JwtSimpleGuard, AuthenticateGenService],
})
export class AccessiModule {
  static forRoot(options: AccessiOptions): DynamicModule {
    return {
      module: AccessiModule,
      providers: [
        {
          provide: 'ACCESSI_OPTIONS',
          useValue: options,
        },
        AuthService,
        UserService,
        EmailService,
        PermissionService,
        FiltriService,
        ConfiguratorService,
        JwtSimpleGuard,
        AuthenticateGenService
      ],
      exports: [
        'ACCESSI_OPTIONS',
        AuthService,
        UserService,
        EmailService,
        PermissionService,
        FiltriService,
        ConfiguratorService,
        JwtSimpleGuard,
        AuthenticateGenService
      ],
    };
  }
}
