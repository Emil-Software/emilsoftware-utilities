import { LoginResult } from '../Dtos/LoginResponse';
import { TokenResult } from '../Dtos/TokenResult';

/**
 * Identita esterna gia verificata dal backend ospitante.
 *
 * Questa e l unica informazione che il backend passa ad Accessi dopo avere
 * concluso il proprio flusso SSO. Accessi non riceve e non verifica token del
 * provider: decide solo quale utente interno corrisponde all identita e quali
 * grant possiede.
 */
export interface VerifiedFederatedIdentity {
  /** Chiave stabile censita in Accessi e configurata nel backend, ad esempio `azure-ad-acme-produzione`. Non e il nome commerciale del provider. */
  provider: string;
  /** ID opaco e stabile dell account presso il provider, ad esempio oid, sub o NameID persistente. Non usare email, nome o username. */
  subject: string;
}

/** Provider SSO censito in Accessi. Le configurazioni e i segreti restano nel backend ospitante. */
export interface FederatedProvider {
  /** Chiave stabile usata dal backend nei payload `{ provider, subject }`. */
  provider: string;
  /** Nome leggibile mostrato agli amministratori nella console. */
  description: string;
  /** Un provider disabilitato non puo autenticare nuove sessioni SSO. */
  active: boolean;
  createdAt?: Date | string;
  note?: string;
}

/** Collegamento persistito fra una identita esterna e un utente Accessi. */
export interface FederatedIdentity {
  /** Chiave tecnica SHA-256 del collegamento. Serve solo alle CRUD amministrative, mai al login SSO. */
  identityKey: string;
  /** Chiave dell utente Accessi che riceve ruoli, grant e sessione interna. */
  codiceUtente: number;
  /** Namespace backend salvato al momento del collegamento. */
  provider: string;
  /** Identificativo esterno usato insieme a provider per riconoscere la persona. */
  subject: string;
  /** Indica se l utente puo usare anche la password locale. */
  passwordLoginEnabled: boolean;
  /** Indica se questo singolo collegamento SSO puo ancora autenticare. */
  active: boolean;
  createdAt?: Date | string;
  lastLoginAt?: Date | string;
  disabledAt?: Date | string;
  note?: string;
}

/** Risultato dello scambio di un identita esterna verificata con una normale sessione Accessi. */
export interface FederatedAuthenticationResult {
  codiceUtente: number;
  login: LoginResult;
  /** Assente quando login.challenge richiede la verifica email. */
  token?: TokenResult;
}
