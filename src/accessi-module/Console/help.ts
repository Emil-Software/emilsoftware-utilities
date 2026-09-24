/**
 * Contenuti di aiuto contestuale della console Accessi.
 *
 * Ogni voce spiega, in italiano corretto, che cosa inserire in un campo
 * tecnico e da dove prendere il valore. Sono mostrati come miniguida nel
 * tooltip aperto dall'icona "i" accanto al campo.
 */
import type { WikiBlock } from './wiki';

export interface HelpEntry {
  title: string;
  blocks: WikiBlock[];
}

const p = (text: string): WikiBlock => ({ kind: 'p', text });
const list = (items: string[]): WikiBlock => ({ kind: 'list', items });
const code = (language: string, codeText: string, title?: string): WikiBlock => ({ kind: 'code', language, title, code: codeText });
const note = (tone: 'info' | 'ok' | 'warn' | 'danger', title: string, text: string): WikiBlock => ({ kind: 'callout', tone, title, text });
const table = (head: string[], rows: string[][]): WikiBlock => ({ kind: 'table', head, rows });

export const HELP: Record<string, HelpEntry> = {
  // ------------------------------------------------------------------ SSO
  'sso-provider': {
    title: 'Provider SSO',
    blocks: [
      p(`La chiave del provider censito in Accessi. Deve coincidere esattamente con quella usata dal backend quando valida il login SSO e chiama FederatedAuthService.authenticate({ provider, subject }).`),
      p(`Se il backend usa la chiave azure-ad-acme-prod, qui va la stessa stringa: una differenza, anche di un carattere, fa fallire il collegamento.`),
      note('info', 'Chi crea il provider', `Prima si censisce il provider in "SSO → Provider" (superutente), poi lo si sceglie qui. Se l'elenco è vuoto, non ci sono provider attivi.`),
    ],
  },
  'sso-subject': {
    title: 'ID utente del provider (subject)',
    blocks: [
      p(`È l'identificatore STABILE della persona nel provider, non l'email. Il backend lo ottiene dopo aver validato il token del provider e lo passa ad Accessi; Accessi non vede mai il token esterno.`),
      p(`Ecco il claim corretto per i provider più comuni:`),
      table(
        ['Provider', 'Claim da usare', 'Note'],
        [
          ['Azure AD / Entra ID', 'oid', 'Object ID. Non usare preferred_username né email.'],
          ['Google', 'sub', 'ID numerico di 21 cifre. Non l indirizzo email.'],
          ['Apple', 'sub', 'Identificatore stabile per la tua app; disponibile solo al primo login, va salvato subito.'],
          ['Okta', 'sub', 'Claim standard OIDC.'],
          ['Auth0', 'sub', 'Formato auth0|... oppure google-oauth2|... .'],
          ['Keycloak', 'sub', 'Claim standard OIDC.'],
          ['Microsoft personale (MSA)', 'sub', 'Account outlook/live.'],
          ['SAML 2.0', 'NameID', 'Identificatore persistente dell utente.'],
          ['OIDC generico', 'sub', 'Claim standard OIDC.'],
        ],
      ),
      note('danger', 'Mai usare l email', `L'email può cambiare e non è un identificatore stabile: usarla come subject crea duplicati e collegamenti errati.`),
      code('ts', [
        '// Nel backend, dopo aver validato il token del provider:',
        '// Azure AD / Entra ID',
        "const subject = claims.oid;",
        '// Google / Okta / Keycloak / OIDC generico',
        "const subject = claims.sub;",
        '// Apple (disponibile al primo login, salvalo subito)',
        "const subject = claims.sub;",
        '// SAML',
        "const subject = assertion.nameId;",
      ].join('\n'), 'Come ricavare il subject'),
    ],
  },
  'sso-note': {
    title: 'Nota',
    blocks: [
      p(`Nota interna per gli amministratori, utile a ricordare perché il collegamento esiste (per esempio "migrato da AD il 2026-01-10"). Non viene inviata al provider.`),
    ],
  },
  'provider-key': {
    title: 'Chiave provider',
    blocks: [
      p(`Identificativo tecnico del provider, usato dal backend nel payload SSO. Scegli una chiave descrittiva e stabile, per esempio azure-ad-acme-prod o google-workspace-acme.`),
      note('warn', 'Immutabile', `Dopo il censimento la chiave non si modifica: identità e configurazione del backend la referenziano. Se serve cambiarla, disabilita il provider e creane uno nuovo.`),
    ],
  },
  'provider-description': {
    title: 'Descrizione',
    blocks: [
      p(`Nome leggibile mostrato agli amministratori (per esempio "Azure AD – Acme produzione"). Non è la chiave tecnica: può contenere spazi.`),
    ],
  },
  'provider-note': {
    title: 'Nota',
    blocks: [
      p(`Nota interna del catalogo. Non inserire segreti, issuer, client id o dati personali: quei valori restano nel backend.`),
    ],
  },
  'provider-active': {
    title: 'Provider attivo',
    blocks: [
      p(`Se disattivato, il provider non accetta nuovi login e nuovi collegamenti; le identità e lo storico restano. Riattivalo quando il backend è pronto.`),
    ],
  },

  // --------------------------------------------------------- service token
  'token-label': {
    title: 'Descrizione del token',
    blocks: [
      p(`Nome del token, mostrato agli amministratori (per esempio "Integrazione IA – produzione"). Non è un segreto.`),
    ],
  },
  'token-scopes': {
    title: 'Scope',
    blocks: [
      p(`Etichette che il backend controlla per autorizzare le chiamate tecniche. Un token non è un superutente: abilita solo le rotte protette con ServiceTokenGuard e @RequireServiceTokenScopes.`),
      list([
        `Formato: lettere, numeri, ':', '_' o '-', massimo 40 caratteri.`,
        `Esempi: ia, chat, tools, report:read.`,
        `Separa gli scope con una virgola.`,
      ]),
      code('ts', [
        '@UseGuards(ServiceTokenGuard)',
        "@RequireServiceTokenScopes('ia')",
        '@Post("internal/ask")',
        'ask() { /* il token deve avere lo scope ia */ }',
      ].join('\n'), 'Come li usa il backend'),
      note('warn', 'Scope vuoto', `Senza scope il token non soddisfa nessun @RequireServiceTokenScopes, ma passa comunque le rotte protette senza scope richiesto.`),
    ],
  },
  'token-ttl': {
    title: 'Durata (giorni)',
    blocks: [
      p(`Giorni di validità del token. Alla scadenza il token smette di funzionare.`),
      note('danger', 'Nessuna scadenza', `Se lasci vuoto questo campo e non imposti una data, il token non scade mai: sconsigliato in produzione.`),
    ],
  },

  // ----------------------------------------------------------------- utenti
  'user-email': {
    title: 'Email',
    blocks: [
      p(`Identificativo di accesso dell'utente e recapito per le email di reset o codici. Deve essere univoca.`),
    ],
  },
  'user-name': {
    title: 'Nome e cognome',
    blocks: [
      p(`Dati anagrafici mostrati in console e restituiti nel profilo. Non incidono sull'autenticazione.`),
    ],
  },
  'user-password-login': {
    title: 'Login con password',
    blocks: [
      p(`Se disattivato, il login con email e password viene rifiutato (PASSWORD_LOGIN_DISABLED). Restano validi i login con identità SSO attive.`),
      note('info', 'Utente solo SSO', `È l'opzione tipica per gli utenti federati: nessuna password locale, accesso solo dal provider.`),
    ],
  },
  'user-2fa': {
    title: 'Codice via email (2FA)',
    blocks: [
      p(`Richiede un codice monouso inviato per email dopo la password o dopo il provider SSO. È per-utente e disattivata per impostazione predefinita.`),
      list([
        `Codice a 6 cifre, valido 10 minuti, 5 tentativi, massimo 3 invii.`,
        `Non sono token: fino alla verifica non esiste alcun JWT.`,
      ]),
    ],
  },
  'user-passwordless': {
    title: 'Accesso con il solo codice email',
    blocks: [
      p(`Abilita il login senza password: si inserisce solo l'email e si usa il codice ricevuto. Richiede il codice email (2FA) attivo.`),
      note('warn', 'Non sono due fattori', `L'accesso con il solo codice è autenticazione tramite possesso della casella email: un solo fattore.`),
    ],
  },
  'user-state': {
    title: 'Stato di registrazione',
    blocks: [
      table(
        ['Stato', 'Significato'],
        [
          ['Non definito / Inserito', 'Utente non confermato.'],
          ['Invitato (10)', 'Richiede il rinnovo della password.'],
          ['Confermato (20)', 'Utente valido, può accedere.'],
          ['Eliminato (50)', 'Soft delete: login bloccato.'],
          ['Bloccato (99)', 'Login bloccato.'],
        ],
      ),
    ],
  },

  // ------------------------------------------------------------------ ruoli
  'role-description': {
    title: 'Descrizione del ruolo',
    blocks: [
      p(`Nome del ruolo (per esempio "Gestore ordini"). Deve avere almeno un menu selezionato: il salvataggio sostituisce integralmente i menu del ruolo.`),
    ],
  },
  'role-level': {
    title: 'Livello di abilitazione',
    blocks: [
      table(
        ['Livello', 'Valore', 'Uso tipico'],
        [
          ['Lettura', '10', 'Sola consultazione.'],
          ['Scrittura', '20', 'Modifica dei dati.'],
          ['Legacy (30)', '30', 'Valore storico, mantenuto senza perdita.'],
        ],
      ),
      p(`Il controllo confronta tipoAbilitazione >= soglia: un livello 20 soddisfa anche una richiesta di livello 10.`),
    ],
  },

  // --------------------------------------------------------- catalogo menu
  'menu-code': {
    title: 'Codice menu',
    blocks: [
      p(`Chiave tecnica del menu, stabile e senza spazi (per esempio ORDINI o MNU001). È la chiave primaria: non si modifica dopo la creazione.`),
      note('warn', 'Immutabile', `Il codice è referenziato da ruoli e grant: per cambiarlo, elimina e ricrea il menu.`),
    ],
  },
  'menu-group-code': {
    title: 'Codice gruppo',
    blocks: [
      p(`Un solo carattere (per esempio A). Raggruppa i menu nella navigazione. Immutabile dopo la creazione.`),
    ],
  },
  'menu-type-code': {
    title: 'Codice tipo menu',
    blocks: [
      p(`Un solo carattere (per esempio X). Classifica i menu (amministrazione, operativo, ...). Immutabile dopo la creazione.`),
    ],
  },
  'menu-group-order': {
    title: 'Ordine del gruppo',
    blocks: [
      p(`Numero che determina l'ordine dei gruppi nella navigazione: valori più bassi compaiono prima.`),
    ],
  },
  'menu-order': {
    title: 'Ordine del menu',
    blocks: [
      p(`Numero che determina l'ordine dei menu all'interno del gruppo: valori più bassi compaiono prima.`),
    ],
  },
  'menu-page': {
    title: 'Pagina',
    blocks: [
      p(`Percorso o nome della pagina del frontend associata al menu (per esempio /ordini). È informativo: lo usano la UI host e i client.`),
    ],
  },
  'menu-icon': {
    title: 'Icona',
    blocks: [
      p(`Identificatore dell'icona usato dalla UI host (per esempio fa-box o un nome concordato). Accessi non impone un set di icone.`),
    ],
  },
  'menu-rifmenu': {
    title: 'Menu di riferimento',
    blocks: [
      p(`Codice di un altro menu che fa da padre, per costruire gerarchie di menu. Lascia vuoto per un menu di primo livello.`),
    ],
  },
  'menu-note': {
    title: 'Nota',
    blocks: [
      p(`Nota descrittiva mostrata agli amministratori. Non incide sui permessi.`),
    ],
  },
  'menu-enabled': {
    title: 'Menu abilitato',
    blocks: [
      p(`Se disattivato, il menu non compare nel catalogo attivo e non viene considerato nel calcolo dei grant. I collegamenti a ruoli e utenti restano.`),
    ],
  },
  'menu-group-enabled': {
    title: 'Gruppo abilitato',
    blocks: [
      p(`Disattiva l'intero gruppo: i menu al suo interno non sono considerati attivi, ma restano configurabili per una riattivazione futura.`),
    ],
  },

  // ----------------------------------------------------------------- filtri
  'filter-type-code': {
    title: 'Codice tipo filtro',
    blocks: [
      p(`Numero identificativo del tipo filtro. È la chiave primaria: non si modifica dopo la creazione.`),
    ],
  },
  'filter-type-field': {
    title: 'Campo',
    blocks: [
      p(`Nome della colonna applicativa della tabella FILTRI a cui il tipo è associato (per esempio CODCLI). Deve esistere nello schema, altrimenti i filtri che lo usano vengono rifiutati.`),
    ],
  },
  'filter-type-enabled': {
    title: 'Tipo filtro abilitato',
    blocks: [
      p(`Se disattivato, il tipo non è proposto ai client, ma i filtri già salvati restano nel database.`),
    ],
  },
  'filters-json': {
    title: 'Filtro JSON',
    blocks: [
      p(`Rappresentazione JSON dei filtri applicativi dell'utente. Usa "Carica" per partire dalla struttura esistente, modifica i valori e poi "Salva".`),
      note('info', 'Campi ammessi', `Sono accettati solo i campi mappati nello schema (FILTRI_UTENTE_DB_MAPPING). Un campo non configurato viene rifiutato con un errore esplicito.`),
    ],
  },
  'filters-user': {
    title: 'Utente',
    blocks: [
      p(`Utente a cui appartengono i filtri. Selezionalo prima di caricare o salvare: i filtri sono sempre per singolo utente.`),
    ],
  },

  // ------------------------------------------------------------ assegnazioni
  'role-assignment': {
    title: 'Assegnazione dei ruoli',
    blocks: [
      p(`Il salvataggio SOSTITUISCE integralmente i ruoli dell'utente: la lista selezionata diventa l'unico set di ruoli.`),
      list([
        `Per aggiungere un ruolo, selezionalo mantenendo quelli già presenti.`,
        `Per rimuovere un ruolo, deselezionalo.`,
        `Non modificare i grant diretti: quelli si gestiscono nella scheda "Grant diretti".`,
      ]),
      note('warn', 'Non è incrementale', `Inviare solo il nuovo ruolo rimuove gli altri. Invia sempre la lista completa desiderata.`),
    ],
  },
  'grant-direct': {
    title: 'Grant diretti',
    blocks: [
      p(`Permessi assegnati direttamente all'utente, indipendenti dai ruoli. Hanno precedenza sui permessi ereditati dai ruoli per lo stesso menu.`),
      list([
        `Imposta il livello per concedere l'accesso.`,
        `Scegli "nessuno" per rimuovere il grant diretto.`,
        `Il salvataggio sostituisce l'intero set di grant diretti.`,
      ]),
    ],
  },
  'grant-level': {
    title: 'Livello di grant',
    blocks: [
      table(
        ['Voce', 'Valore', 'Significato'],
        [
          ['nessuno', '—', 'Nessun grant diretto per quel menu (il permesso può arrivare dai ruoli).'],
          ['Lettura', '10', 'Sola consultazione.'],
          ['Scrittura', '20', 'Modifica dei dati.'],
        ],
      ),
      p(`Il confronto è tipoAbilitazione >= soglia richiesta dalla rotta.`),
    ],
  },
  'user-delete': {
    title: 'Imposta stato eliminato',
    blocks: [
      p(`Esegue un soft delete: imposta lo stato di registrazione a "Eliminato" (50). L'utente non può più accedere, ma i dati restano nel database.`),
      note('info', 'Reversibile', `Non è una cancellazione fisica: puoi ripristinare l'utente cambiando lo stato di registrazione.`),
    ],
  },

  // ----------------------------------------------------- selezioni di menu
  'menu-group-select': {
    title: 'Gruppo',
    blocks: [
      p(`Gruppo di appartenenza del menu. Se l'elenco è vuoto, crea prima un gruppo in "Menu e gruppi → Gruppi".`),
    ],
  },
  'menu-type-select': {
    title: 'Tipo menu',
    blocks: [
      p(`Classificazione del menu (amministrazione, operativo, ...). È facoltativa: se non serve, lascia "Nessun tipo". I tipi si gestiscono in "Menu e gruppi → Tipi menu".`),
    ],
  },

  // ------------------------------------------------------------------ login
  'login-email': {
    title: 'Email o utente',
    blocks: [
      p(`Indirizzo email dell'utente Accessi. Se l'account è abilitato al solo codice, dopo questo passo riceverai un codice via email invece di inserire la password.`),
    ],
  },
  'login-password': {
    title: 'Password',
    blocks: [
      p(`Password locale dell'utente. Non serve per gli account passwordless, che accedono con il solo codice email.`),
    ],
  },
};
