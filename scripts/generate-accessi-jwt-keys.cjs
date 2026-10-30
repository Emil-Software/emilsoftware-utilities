// Genera una coppia di chiavi per gli access token Accessi e la JWKS pubblica.
// Uso:
//   node scripts/generate-accessi-jwt-keys.cjs --algorithm RS256 --out ./keys
const { createHash, createPublicKey, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const algorithm = String(arg('algorithm', 'RS256')).toUpperCase();
if (algorithm !== 'RS256' && algorithm !== 'ES256') {
  console.error('Algoritmo supportato: RS256 oppure ES256.');
  process.exit(1);
}

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

const publicKeyObject = createPublicKey(keys.publicKey);
const jwk = publicKeyObject.export({ format: 'jwk' });
const keyId = createHash('sha256')
  .update(publicKeyObject.export({ type: 'spki', format: 'der' }))
  .digest('base64url')
  .slice(0, 16);

const output = {
  algorithm,
  keyId,
  privateKey: keys.privateKey,
  publicKey: keys.publicKey,
  jwks: {
    keys: [{ ...jwk, kid: keyId, alg: algorithm, use: 'sig' }],
  },
};

const outDir = arg('out');
if (outDir) {
  const directory = path.resolve(outDir);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'jwt-private.pem'), `${keys.privateKey}\n`);
  fs.writeFileSync(path.join(directory, 'jwt-public.pem'), `${keys.publicKey}\n`);
  fs.writeFileSync(path.join(directory, 'jwks.json'), `${JSON.stringify(output.jwks, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, 'jwt-keys.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Chiavi generate in ${directory}`);
  console.log(`Key id: ${keyId}`);
  console.log('Conserva jwt-private.pem come secret; pubblica jwt-public.pem/JWKS e configura jwtOptions.keyId.');
} else {
  console.log(JSON.stringify(output, null, 2));
}
