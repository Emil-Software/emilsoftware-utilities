import { TwoFactorService } from './Services/TwoFactorService/TwoFactorService';
/**
 * Modulo che gestisce le operazioni di accesso degli utenti, incluse le rotte, il controller e il modello.
 *
 * @module AccessiModule
 * @author mttdev382
 */
import { Options } from 'node-firebird';
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
import { AccessiDatabaseUpdater } from './database-updates/AccessiDatabaseUpdater';
import { FederatedAuthService } from './federated-auth/FederatedAuthService';
import { FederatedAuthController } from './federated-auth/FederatedAuthController';
import { AccessiConsoleController } from './Controllers/AccessiConsoleController';
import { ServiceTokenController } from './Controllers/ServiceTokenController';
import { ServiceTokenService } from './Services/ServiceTokenService/ServiceTokenService';
import { ServiceTokenGuard } from './security/serviceTokenGuard';
import { assertEmailConfigured } from './security/emailConfiguration';

/** JWT emesso da Accessi dopo un login locale o SSO. Non riutilizzare il segreto del provider SSO. */
export interface JwtOptions {
  /** Segreto simmetrico per firmare e verificare i JWT Accessi; deve essere unico per ambiente. */
  secret: string;
  /** Durata compatibile con `jsonwebtoken`, per esempio `24h` o `3600s`. */
  expiresIn: string;
}

/** Parametri SMTP usati esclusivamente per impostazione e reset della password. */
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

/** Configura campi applicativi aggiuntivi restituiti insieme al profilo Accessi. */
export interface ExtensionFieldsOptions {
  /** Connessione al database contenente la tabella estesa. */
  databaseOptions: Options;
  /** Chiave con cui i dati saranno esposti nella risposta. */
  objectKey: string;
  /** Tabella applicativa contenente i dati estesi. */
  tableName: string;
  /** Colonne consentite; non valorizzarle mai con input HTTP. */
  tableFields: string[];
  /** Colonna correlata a `UTENTI.CODUTE`. */
  tableJoinFieldName: string;
}

/** Limite per una singola categoria di endpoint pubblici. */
export interface PublicAuthRateLimitRuleOptions {
  windowMs: number;
  maxAttempts: number;
}

/** Protezione in-memory degli endpoint pubblici. In cluster aggiungere un limite anche al gateway. */
export interface PublicAuthRateLimitOptions {
  enabled?: boolean;
  login?: PublicAuthRateLimitRuleOptions;
  register?: PublicAuthRateLimitRuleOptions;
  passwordResetEmail?: PublicAuthRateLimitRuleOptions;
  passwordResetConfirm?: PublicAuthRateLimitRuleOptions;
  getUserByToken?: PublicAuthRateLimitRuleOptions;
  twoFactorVerify?: PublicAuthRateLimitRuleOptions;
  twoFactorResend?: PublicAuthRateLimitRuleOptions;
}

/** Controls the legacy public username/password registration endpoint. Disabled by default. */
export interface PublicRegistrationOptions {
  /** Enables POST /accessi/user/register. Applications that used it before must opt in explicitly. */
  enabled?: boolean;
}

/** Configurazione dei token di servizio (macchina-a-macchina, senza utente). */
export interface ServiceTokenOptions {
  /** Abilita gli endpoint amministrativi dei service token. Default `true`. */
  enabled?: boolean;
  /** Durata predefinita in giorni quando non e indicata una scadenza esplicita. Default: nessuna scadenza. */
  defaultTtlDays?: number;
}

/** Cosa fare quando uno script gia applicato presenta un checksum diverso (file modificato). */
export type CatalogScriptChecksumPolicy = 'error' | 'warn' | 'reapply';

/**
 * Catalog migrations applicative (menu, ruoli, tipi, cataloghi). Gli script `.sql` vivono nel
 * backend ospitante (versionati in repository) e vengono eseguiti da Accessi dopo la
 * riconciliazione dello schema. Ogni script e tracciato nella tabella `ACCESSI_CATALOG_SCRIPT`,
 * quindi viene applicato una sola volta per database (idempotenza lato DB).
 */
export interface CatalogScriptsOptions {
  /** Abilita l'esecuzione automatica al bootstrap. Default `false`. */
  enabled?: boolean;
  /** Cartella contenente gli script `.sql` (assoluta o relativa alla working directory). */
  folder: string;
  /** Cosa fare se il checksum di uno script applicato e cambiato. Default `error`. */
  onChecksumMismatch?: CatalogScriptChecksumPolicy;
  /** Se `true` (default) un errore interrompe l'esecuzione e non avanza allo script successivo. */
  stopOnError?: boolean;
  /** Globi/estensioni inclusi. Default: tutti i `.sql`. */
  include?: string[];
  /** Numero massimo di script eseguiti in un singolo run (protezione operativa). Default: illimitato. */
  maxScriptsPerRun?: number;
}

/**
 * Enables Accessi's provider-agnostic federated identity capability.
 *
 * Accessi never validates Azure, Google, Apple, SAML, or other provider tokens.
 * The hosting backend must validate its own SSO flow and pass only a verified
 * `{ provider, subject }` identity to FederatedAuthService.
 */
export interface FederatedAuthenticationOptions {
  /** Attiva le API SSO generiche; con `false` il comportamento password storico rimane invariato. */
  enabled?: boolean;
  /** @deprecated Schema management is centralized in autoUpdateDatabase. This legacy flag no longer starts separate SSO migrations. */
  autoUpdateSchema?: boolean;
  /** Allows a backend to create a user from a verified external identity without a master user. Default false. */
  allowSelfRegistration?: boolean;
}

/**
 * Configurazione completa del modulo Accessi, fornita esclusivamente dal backend ospitante.
 * Segreti JWT, SMTP, database e le configurazioni tecniche dei provider SSO non devono mai raggiungere il browser.
 */
export interface AccessiOptions {
  /** Connessione Firebird alla base dati Accessi. */
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
  /** URL di ritorno della pagina standard di reset dopo il completamento. */
  confirmationEmailReturnUrl: string;
  /** Prefisso applicativo facoltativo trasmesso alla pagina standard di reset. */
  confirmationEmailPrefix?: string;
  /** Chiave riservata alla compatibilita e alla migrazione delle password legacy cifrate. */
  encryptionKey: string;
  /** Abilita gli utenti fittizi `admin` e `demo` solo fuori produzione. */
  mockDemoUser: boolean;
  /** Attiva il controllo della scadenza password durante il login locale. */
  passwordExpiration?: boolean;
  /** Giorni di validita della password; quando assente Accessi usa 90 giorni. */
  passwordExpirationDays?: number;
  /** Esegue al bootstrap la conversione non distruttiva delle password legacy. Default `true`. */
  legacyPasswordMigrationOnStartup?: boolean;
  /** Riconcilia lo schema al bootstrap (default `true`). Con `false` verifica comunque la compatibilita in sola lettura e blocca avvii incompatibili. */
  autoUpdateDatabase?: boolean;
  /** Parametri JWT dei token emessi da Accessi. */
  jwtOptions: JwtOptions;
  /** Parametri SMTP per reset e attivazione password. */
  emailOptions: EmailOptions;
  publicAuthRateLimit?: PublicAuthRateLimitOptions;
  /** Public local registration is deliberately opt-in. Existing applications must set enabled: true to retain it. */
  publicRegistration?: PublicRegistrationOptions;
  /** Optional provider-agnostic SSO support. Provider-specific configuration remains in the hosting backend. */
  federatedAuthentication?: FederatedAuthenticationOptions;
  extensionFieldsOptions?: ExtensionFieldsOptions[];
  /** Token di servizio per chiamate tecniche macchina-a-macchina. Abilitati di default. */
  serviceTokens?: ServiceTokenOptions;
  /** Catalog migrations applicative eseguite dopo la riconciliazione dello schema. */
  catalogScripts?: CatalogScriptsOptions;
}

@Global()
@Module({
  controllers: [
    EmailController,
    AuthController,
    PermissionController,
    UserController,
    FiltriController,
    ConfiguratorController,
    FederatedAuthController,
    AccessiConsoleController,
    ServiceTokenController,
  ],
  providers: [AuthService, TwoFactorService, UserService, EmailService, PermissionService, FiltriService, ConfiguratorService, JwtSimpleGuard, AuthenticateGenService, AccessiDatabaseUpdater, FederatedAuthService, ServiceTokenService, ServiceTokenGuard],
  exports: [AuthService, UserService, EmailService, PermissionService, FiltriService, ConfiguratorService, JwtSimpleGuard, AuthenticateGenService, FederatedAuthService, ServiceTokenService, ServiceTokenGuard],
})
export class AccessiModule {
  /**
   * Registra Accessi nel contenitore Nest del backend ospitante.
   *
   * Usare questo metodo una sola volta nella composizione dell'applicazione. Per un backend
   * Express esistente usare invece `initializeAccessiModule`, che crea e monta l'host Nest interno.
   * La configurazione viene registrata con il token DI `ACCESSI_OPTIONS` ed e condivisa dai servizi.
   */
  static forRoot(options: AccessiOptions): DynamicModule {
    // Il servizio email e obbligatorio: reset password, 2FA e creazione utente ne dipendono.
    assertEmailConfigured(options);
    return {
      module: AccessiModule,
      providers: [
        {
          provide: 'ACCESSI_OPTIONS',
          useValue: options,
        },
        AuthService,
        TwoFactorService,
        UserService,
        EmailService,
        PermissionService,
        FiltriService,
        ConfiguratorService,
        JwtSimpleGuard,
        AuthenticateGenService,
        AccessiDatabaseUpdater,
        FederatedAuthService,
        ServiceTokenService,
        ServiceTokenGuard
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
        AuthenticateGenService,
        FederatedAuthService,
        ServiceTokenService,
        ServiceTokenGuard
      ],
    };
  }
}
