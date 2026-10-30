// Client Redis minimale (RESP2) per i test di integrazione.
//
// Gli store Accessi accettano qualunque client con `eval(script, numKeys, ...args)`
// (ioredis, node-redis, ...). Per non aggiungere una dipendenza al package, i test
// usano questo client TCP che parla il protocollo RESP2 e implementa `eval`.
const net = require('node:net');

const DEFAULT_PORT = 6379;
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;

function parseRedisUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`ACCESSI_TEST_REDIS_URL non valida: ${rawUrl}`);
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`ACCESSI_TEST_REDIS_URL deve usare redis:// o rediss:// (ricevuto ${parsed.protocol})`);
  }

  const databasePath = parsed.pathname.replace(/^\//, '');
  const database = databasePath === '' ? 0 : Number(databasePath);
  if (!Number.isInteger(database) || database < 0) {
    throw new Error(`ACCESSI_TEST_REDIS_URL: database non valido "${databasePath}"`);
  }

  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : DEFAULT_PORT,
    // `URL` decodifica da sola le sequenze percentuali in username/password.
    username: parsed.username ? decodeURIComponent(parsed.username) : '',
    password: parsed.password ? decodeURIComponent(parsed.password) : '',
    database,
    tls: parsed.protocol === 'rediss:',
  };
}

function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.from(String(arg), 'utf8');
    parts.push(`$${value.length}\r\n`, value, '\r\n');
  }
  return Buffer.concat(parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8'))));
}

/**
 * Legge una reply RESP2 a partire da `offset`.
 * Ritorna `null` quando il buffer e incompleto, altrimenti `{ value, next }`.
 */
function parseReply(buffer, offset) {
  if (offset >= buffer.length) return null;

  const marker = String.fromCharCode(buffer[offset]);
  const eol = buffer.indexOf('\r\n', offset + 1);
  if (eol === -1) return null;
  const line = buffer.toString('utf8', offset + 1, eol);

  switch (marker) {
    case '+':
      return { value: line, next: eol + 2 };
    case '-':
      return { error: new Error(line), next: eol + 2 };
    case ':':
      return { value: Number(line), next: eol + 2 };
    case '$': {
      const length = Number(line);
      if (length === -1) return { value: null, next: eol + 2 };
      const start = eol + 2;
      const end = start + length;
      if (buffer.length < end + 2) return null;
      return { value: buffer.toString('utf8', start, end), next: end + 2 };
    }
    case '*': {
      const count = Number(line);
      if (count === -1) return { value: null, next: eol + 2 };
      const items = [];
      let cursor = eol + 2;
      for (let index = 0; index < count; index += 1) {
        const parsed = parseReply(buffer, cursor);
        if (!parsed) return null;
        if (parsed.error) throw parsed.error;
        items.push(parsed.value);
        cursor = parsed.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`Reply RESP non riconosciuta: "${marker}"`);
  }
}

class RedisTestClient {
  constructor(url) {
    this.url = url;
    this.target = parseRedisUrl(url);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.failure = null;
  }

  async connect(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
    const { host, port } = this.target;

    await new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`timeout di connessione a Redis ${host}:${port}`));
      }, timeoutMs);

      socket.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.failPending(error));
        socket.on('close', () => this.failPending(new Error('connessione Redis chiusa')));
        resolve();
      });
    });

    try {
      if (this.target.password) {
        if (this.target.username) {
          await this.command('AUTH', this.target.username, this.target.password);
        } else {
          await this.command('AUTH', this.target.password);
        }
      }
      if (this.target.database > 0) {
        await this.command('SELECT', this.target.database);
      }
    } catch (error) {
      this.socket?.destroy();
      throw error;
    }

    return this;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    let offset = 0;
    for (;;) {
      let parsed;
      try {
        parsed = parseReply(this.buffer, offset);
      } catch (error) {
        this.buffer = Buffer.alloc(0);
        this.failPending(error);
        this.socket?.destroy();
        return;
      }
      if (!parsed) break;

      offset = parsed.next;
      const pending = this.pending.shift();
      if (!pending) continue;
      if (parsed.error) pending.reject(parsed.error);
      else pending.resolve(parsed.value);
    }

    this.buffer = offset >= this.buffer.length ? Buffer.alloc(0) : this.buffer.subarray(offset);
  }

  failPending(error) {
    this.failure = error;
    const pending = this.pending;
    this.pending = [];
    for (const entry of pending) entry.reject(error);
  }

  command(...args) {
    if (!this.socket || this.socket.destroyed || this.failure) {
      return Promise.reject(this.failure ?? new Error('connessione Redis non attiva'));
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(args));
    });
  }

  /** Interfaccia richiesta dagli store Accessi (compatibile con ioredis). */
  eval(script, numKeys, ...args) {
    return this.command('EVAL', script, String(numKeys), ...args.map((value) => String(value)));
  }

  async quit() {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      this.socket = null;
      return;
    }
    try {
      await this.command('QUIT');
    } catch {
      // Il server chiude la connessione subito dopo QUIT: l'errore non e rilevante.
    }
    socket.destroy();
    this.socket = null;
    this.failPending(new Error('connessione Redis chiusa'));
  }
}

module.exports = { RedisTestClient, parseRedisUrl };
