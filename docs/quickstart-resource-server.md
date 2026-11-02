# Quickstart: backend fratello (resource server)

Questa guida è per un backend che deve accettare i token emessi da Accessi
Service ma **non** possiede il database Accessi. Non installare
`AccessiModule` e non configurare credenziali Firebird di Accessi.

## Scegli la modalità

| Modalità | Quando usarla | Cosa serve |
| --- | --- | --- |
| Solo verifica JWT | La firma e i claim bastano; i grant non cambiano durante la sessione | Chiave pubblica/JWKS oppure segreto HS256 |
| JWT + introspection | Servono ruoli e grant correnti, revoche e stato utente aggiornato | Service token con scope `accessi:introspect` |
| Solo introspection | Vuoi che Accessi Service decida ogni richiesta | Service token e latenza di rete accettabile |

In produzione multi-servizio usa RS256/ES256 con JWKS. HS256 con segreto
condiviso è accettabile solo come transizione.

## Express

```ts
import {
  createAccessiAuthMiddleware,
} from 'emilsoftware-utilities/accessi/resource-server';

app.use(createAccessiAuthMiddleware({
  mode: 'local',
  jwt: {
    jwks: { url: 'https://accessi.example.com/accessi/.well-known/jwks.json' },
    issuer: 'https://accessi.example.com',
    audience: 'backend-a',
  },
  introspection: {
    url: 'https://accessi.example.com/api/accessi/auth/introspect',
    serviceToken: process.env.ACCESSI_SERVICE_TOKEN!,
    cacheTtlMs: 30_000,
    timeoutMs: 3_000,
  },
  authorization: {
    requirements: [{ menuCode: 'ORDINI', minPermissionLevel: 20 }],
  },
}));
```

Dopo il middleware:

- `req.user`: payload autenticato.
- `req.data`: alias storico di `req.user`.
- `req.userGrants`: presente solo se la policy richiede i grant.
- `req.accessi`: `{ token, user, codiceUtente, grants?, payload? }`.

## NestJS

```ts
import { UseGuards, Get, Req } from '@nestjs/common';
import {
  createAccessiAuthGuard,
  type AccessiAuthenticatedRequest,
} from 'emilsoftware-utilities/accessi/resource-server';

@UseGuards(createAccessiAuthGuard({
  jwt: {
    publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY,
    algorithms: ['RS256'],
    issuer: 'https://accessi.example.com',
    audience: 'backend-a',
  },
  introspection: {
    url: process.env.ACCESSI_INTROSPECT_URL!,
    serviceToken: process.env.ACCESSI_SERVICE_TOKEN!,
  },
  authorization: {
    requirements: [{ menuCode: 'ORDINI', minPermissionLevel: 20 }],
  },
}))
@Get('ordini')
list(@Req() req: AccessiAuthenticatedRequest) {
  return req.user;
}
```

## Verifica solo JWT

Se non ti servono i grant correnti, puoi usare il verifier senza middleware:

```ts
import { createAccessiTokenVerifier } from 'emilsoftware-utilities/accessi/resource-server';

const verify = createAccessiTokenVerifier({
  jwks: { url: process.env.ACCESSI_JWKS_URL! },
  issuer: 'https://accessi.example.com',
  audience: 'backend-a',
});

const payload = await verify(token);
```

## Introspection

`POST /api/accessi/auth/introspect` richiede un service token con scope
`accessi:introspect`.

```json
{
  "Status": { "errorCode": "0", "errorDescription": "" },
  "Result": {
    "active": true,
    "user": { "codiceUtente": 123, "email": "utente@example.com" },
    "grants": { "abilitazioni": [], "ruoli": [], "grants": [] }
  },
  "Message": "Dati recuperati con successo."
}
```

Regole:

- `active: false` per token invalido, scaduto o utente disabilitato.
- Gli errori di database o configurazione sono 500: non vanno interpretati come token scaduto.
- I risultati attivi sono cachati per `cacheTtlMs` (default 30 secondi).
- Fail closed: se Accessi Service non risponde, la richiesta non viene autorizzata.

## Revoche

Per applicare le revoche anche nel backend fratello, usa gli stessi store di
Accessi Service:

```ts
import {
  createRedisAccessTokenRevocationStore,
  createRedisRefreshTokenRotationStore,
  createRedisSessionRevocationStore,
} from 'emilsoftware-utilities/accessi/resource-server';

const revocation = {
  store: createRedisSessionRevocationStore({ client: redis, ttlMs }),
  accessTokenStore: createRedisAccessTokenRevocationStore({ client: redis }),
  familyStore: createRedisRefreshTokenRotationStore({ client: redis }),
};
```

Se il backend fratello non può dipendere da `accessi/server` (per esempio per
non trascinare Nest), applica la revoca tramite introspection: Accessi Service
restituisce `active: false` per un token revocato.

## Errori da gestire

| HTTP | Codice | Significato |
| --- | --- | --- |
| 401 | `AUTH_TOKEN_MISSING` | Header Bearer assente o malformato |
| 401 | `AUTH_TOKEN_INVALID` | Firma, scadenza, issuer/audience o tipo token non validi |
| 401 | `AUTH_USER_CODE_MISSING` | Token senza `codiceUtente` |
| 403 | `AUTH_INSUFFICIENT_PERMISSIONS` | Policy non soddisfatta |
| 500 | `AUTH_CONFIG_INVALID` | Configurazione resource server incompleta |
| 500 | `AUTH_GRANTS_SOURCE_MISSING` | Policy richiede grant ma introspection non configurata |
| 503 | `AUTH_INTROSPECTION_UNAVAILABLE` | Accessi Service non raggiungibile: fail closed |
| 503 | `AUTH_INTROSPECTION_UNAUTHORIZED` | Service token invalido o senza scope |
| 503 | `AUTH_JWKS_UNAVAILABLE` | JWKS non raggiungibile: fail closed |

## Service token

1. Abilita `serviceTokens` su Accessi Service.
2. Crea il token dalla console o con `POST /api/accessi/service-token`.
3. Assegna lo scope minimo: `accessi:introspect` per l'introspection.
4. Conservalo nel secret manager del backend fratello.
5. Ruotalo periodicamente; il segreto è mostrato una sola volta.

Non usare un service token nel browser e non registrarlo nei log.

## Checklist

- Nessuna credenziale del database Accessi nel backend fratello.
- `issuer` e `audience` allineati ad Accessi Service.
- JWKS con cache e timeout, oppure `publicKey` statica.
- Introspection con service token e cache breve se servono i grant.
- Policy esplicita sulle rotte sensibili.
- 401, 403 e 503 gestiti senza autorizzare per errore.
- `trust proxy` e rate limit configurati se il backend è dietro un proxy.
- Test con token valido, scaduto, utente disabilitato, permessi insufficienti e introspection non raggiungibile.
