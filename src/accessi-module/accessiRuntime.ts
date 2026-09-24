import type { Application } from "express";
import type { INestApplication } from "@nestjs/common";
import { AuthService } from "./Services/AuthService/AuthService";
import { UserService } from "./Services/UserService/UserService";
import { EmailService } from "./Services/EmailService/EmailService";
import { PermissionService } from "./Services/PermissionService/PermissionService";
import { ServiceTokenService } from "./Services/ServiceTokenService/ServiceTokenService";
import { TwoFactorService } from "./Services/TwoFactorService/TwoFactorService";
import { FederatedAuthService } from "./federated-auth/FederatedAuthService";
import { AuthenticateGenService } from "./middleware/authenticateGen";

/**
 * Servizi Nest del modulo Accessi resi disponibili all'applicazione Express ospitante.
 *
 * Serve ai backend che, pur montando Accessi come modulo, devono delegare il proprio
 * flusso di login/SSO ai servizi ufficiali (invece di reimplementare firma JWT e
 * verifica password). Estrarre i servizi dal contenitore Nest evita di duplicare la
 * logica di derivazione delle chiavi e il contratto dei token.
 */
export interface AccessiModuleServices {
  /** Autenticazione locale, verifica token, 2FA e reset password. */
  authService: AuthService;
  /** Profilo utente, snapshot autorevole e gestione utenti. */
  userService: UserService;
  /** SSO provider-agnostico: scambio identità esterna verificata -> sessione Accessi. */
  federatedAuthService: FederatedAuthService;
  /** Challenge 2FA / passwordless. */
  twoFactorService: TwoFactorService;
  /** Ruoli, menu e grant effettivi. */
  permissionService: PermissionService;
  /** Invio email di reset/attivazione. */
  emailService: EmailService;
  /** Token macchina-a-macchina. */
  serviceTokenService: ServiceTokenService;
  /** Middleware Express di autorizzazione (bridge usato da authorizeAccessi). */
  authenticateGenService: AuthenticateGenService;
}

/** Chiave usata su `app.locals` per esporre i servizi Accessi all'host Express. */
export const ACCESSI_MODULE_SERVICES_LOCALS_KEY = "accessiServices";

/** Estrae i servizi Accessi dal contenitore Nest e li aggancia a `app.locals`. */
export function registerAccessiModuleServices(
  app: Application,
  nestApp: INestApplication
): AccessiModuleServices {
  const services: AccessiModuleServices = {
    authService: nestApp.get(AuthService),
    userService: nestApp.get(UserService),
    federatedAuthService: nestApp.get(FederatedAuthService),
    twoFactorService: nestApp.get(TwoFactorService),
    permissionService: nestApp.get(PermissionService),
    emailService: nestApp.get(EmailService),
    serviceTokenService: nestApp.get(ServiceTokenService),
    authenticateGenService: nestApp.get(AuthenticateGenService),
  };

  app.locals[ACCESSI_MODULE_SERVICES_LOCALS_KEY] = services;
  return services;
}

/**
 * Recupera i servizi Accessi dall'app Express ospitante.
 * Restituisce `undefined` se il modulo non è ancora stato inizializzato.
 */
export function getAccessiModuleServices(
  app: Application | undefined
): AccessiModuleServices | undefined {
  return app?.locals?.[ACCESSI_MODULE_SERVICES_LOCALS_KEY];
}
