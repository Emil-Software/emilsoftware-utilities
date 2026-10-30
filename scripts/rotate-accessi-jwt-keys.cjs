// Ruota la chiave di firma degli access token Accessi senza invalidare i token emessi.
//
// Genera una nuova coppia, costruisce la lista `previousPublicKeys` (vecchia
// chiave corrente + chiavi precedenti gia configurate) e produce i valori da
// passare al secret manager. Con `--check <url>` verifica che la JWKS pubblicata
// contenga tutti i kid del nuovo documento: va eseguito dopo il deploy.
//
// Uso:
//   node scripts/rotate-accessi-jwt-keys.cjs --out ./keys-2026-10 \
//     --current-public-key-file ./keys-2025-01/jwt-public.pem \
//     --current-key-id 2025-01 \
//     --previous-file ./previous-keys.json
//
//   node scripts/rotate-accessi-jwt-keys.cjs --out ./keys-2026-10 \
//     --check https://accessi.example.com/api/accessi/.well-known/jwks.json
const { createHash, createPublicKey, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALGORITHMS = new Set(['RS256', 'ES256']);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readValue(value, file) {
  if (file) return fs.readFileSync(path.resolve(file), 'utf8');
  if (value === undefined) return undefined;
  return value.replace(/\\n/g, '\n');
}

function fingerprint(publicKey) {
  const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64url').slice(0, 16);
}

function toPreviousKey(entry, position) {
  if (typeof entry === 'string') {
    if (entry.trim() === '') throw new Error(`${position}: chiave pubblica vuota.`);
    return { publicKey: entry.replace(/\\n/g, '\n') };
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${position}: atteso un PEM o un oggetto { publicKey, keyId, algorithm }.`);
  }
  if (typeof entry.publicKey !== 'string' || entry.publicKey.trim() === '') {
    throw new Error(`${position}: publicKey non valido.`);
  }
  return {
    publicKey: entry.publicKey.replace(/\\n/g, '\n'),
    ...(typeof entry.keyId === 'string' && entry.keyId.trim() !== '' ? { keyId: entry.keyId.trim() } : {}),
    ...(typeof entry.algorithm === 'string' ? { algorithm: entry.algorithm.toUpperCase() } : {}),
  };
}

function parsePrevious(raw, source) {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source}: JSON non valido (${error.message}).`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${source}: atteso un array JSON.`);
  }
  return parsed.map((entry, index) => toPreviousKey(entry, `${source}[${index}]`));
}

function keyIdentity(key) {
  return key.keyId ?? fingerprint(key.publicKey);
}

async function checkJwks(url, document) {
  let payload;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch (error) {
    fail(`JWKS non raggiungibile (${url}): ${error.message}`);
  }
  if (!payload || !Array.isArray(payload.keys)) {
    fail(`Risposta JWKS non valida (${url}).`);
  }
  const remoteKids = new Set(payload.keys.map((key) => key && key.kid).filter(Boolean));
  const missing = document.keys.map((key) => key.kid).filter((kid) => !remoteKids.has(kid));
  const extra = [...remoteKids].filter((kid) => !document.keys.some((key) => key.kid === kid));
  if (missing.length > 0) {
    fail(`JWKS incompleta: kid mancanti ${missing.join(', ')}. Deploy non allineato.`);
  }
  console.log(`JWKS OK: ${document.keys.length} kid presenti (${document.keys.map((key) => key.kid).join(', ')}).`);
  if (extra.length > 0) {
    console.log(`Chiavi remote non piu necessarie (rimuovibili dopo il rollout): ${extra.join(', ')}.`);
  }
}

async function main() {
  const outDir = arg('out');
  const checkUrl = arg('check');
  if (!outDir) fail('Specificare --out <directory>.');
  if (flag('only-check') && !checkUrl) fail('--only-check richiede --check <jwks-url>.');

  const directory = path.resolve(outDir);
  fs.mkdirSync(directory, { recursive: true });
  const jwksFile = path.join(directory, 'jwks.json');

  // --check da solo: usa il jwks.json gia generato.
  if (checkUrl && flag('only-check')) {
    if (!fs.existsSync(jwksFile)) fail(`File non trovato: ${jwksFile}`);
    await checkJwks(checkUrl, JSON.parse(fs.readFileSync(jwksFile, 'utf8')));
    return;
  }

  const algorithm = String(arg('algorithm', 'RS256')).toUpperCase();
  if (!ALGORITHMS.has(algorithm)) fail('Algoritmo supportato: RS256 oppure ES256.');

  const retain = Number(arg('retain', '3'));
  if (!Number.isInteger(retain) || retain < 0) fail('--retain deve essere un intero >= 0.');

  const keys = algorithm === 'RS256'
    ? generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
    : generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

  const keyId = createHash('sha256')
    .update(createPublicKey(keys.publicKey).export({ type: 'spki', format: 'der' }))
    .digest('base64url')
    .slice(0, 16);

  const previousRaw = process.env.ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS ?? arg('previous');
  let previous = parsePrevious(
    readValue(previousRaw, arg('previous-file')),
    arg('previous-file') ?? 'ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS/--previous',
  );

  const currentPublicKey = readValue(arg('current-public-key'), arg('current-public-key-file'));
  const currentKeyId = arg('current-key-id');
  if (currentPublicKey) {
    previous.unshift({
      publicKey: currentPublicKey,
      ...(currentKeyId ? { keyId: currentKeyId } : {}),
      ...(arg('current-algorithm') ? { algorithm: String(arg('current-algorithm')).toUpperCase() } : {}),
    });
  } else if (currentKeyId) {
    fail('--current-key-id richiede --current-public-key (o --current-public-key-file).');
  }

  // Deduplica e limita le chiavi precedenti: la nuova chiave corrente non deve mai comparire.
  const newIdentity = keyId;
  const seen = new Set([newIdentity]);
  previous = previous.map((key) => {
    try {
      createPublicKey(key.publicKey);
    } catch {
      fail(`Chiave precedente non valida${key.keyId ? ` (${key.keyId})` : ''}: non e un PEM pubblico.`);
    }
    return key;
  }).filter((key) => {
    const identity = keyIdentity(key);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, retain);

  const jwk = createPublicKey(keys.publicKey).export({ format: 'jwk' });
  const document = {
    keys: [
      { ...jwk, kid: keyId, alg: algorithm, use: 'sig' },
      ...previous.map((key) => {
        const previousAlgorithm = key.algorithm ?? algorithm;
        const previousJwk = createPublicKey(key.publicKey).export({ format: 'jwk' });
        return { ...previousJwk, kid: key.keyId ?? fingerprint(key.publicKey), alg: previousAlgorithm, use: 'sig' };
      }),
    ],
  };

  const rotation = {
    algorithm,
    keyId,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    previousKeyIds: document.keys.slice(1).map((key) => key.kid),
    env: {
      ACCESSI_JWT_ALGORITHM: algorithm,
      ACCESSI_JWT_PRIVATE_KEY: keys.privateKey,
      ACCESSI_JWT_PUBLIC_KEY: keys.publicKey,
      ACCESSI_JWT_KEY_ID: keyId,
      ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS: JSON.stringify(previous),
    },
  };

  fs.writeFileSync(path.join(directory, 'jwt-private.pem'), `${keys.privateKey}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'jwt-public.pem'), `${keys.publicKey}\n`);
  fs.writeFileSync(jwksFile, `${JSON.stringify(document, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, 'rotation.json'), `${JSON.stringify(rotation, null, 2)}\n`, { mode: 0o600 });

  console.log(`Chiavi ruotate in ${directory}`);
  console.log(`Nuovo key id: ${keyId}`);
  console.log(`Chiavi precedenti mantenute: ${rotation.previousKeyIds.length > 0 ? rotation.previousKeyIds.join(', ') : '(nessuna)'}`);
  console.log('Passi successivi:');
  console.log('1. Applica rotation.json al secret manager e riavvia Accessi (JWKS pubblica nuova + vecchie chiavi).');
  console.log('2. Con consumatori JWKS il refresh e automatico sul primo kid sconosciuto.');
  console.log('3. Con consumatori a chiave statica distribuisci prima la nuova chiave pubblica.');
  console.log(`4. Dopo il deploy verifica: node scripts/rotate-accessi-jwt-keys.cjs --out "${directory}" --check <jwks-url> --only-check`);
  console.log('5. Rimuovi le chiavi precedenti dopo la durata massima di access e refresh token.');

  if (flag('print-env')) {
    console.log(JSON.stringify(rotation.env, null, 2));
  }

  if (checkUrl) {
    await checkJwks(checkUrl, document);
  }
}

main().catch((error) => fail(error.message));
