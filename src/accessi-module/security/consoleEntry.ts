import { randomBytes } from 'crypto';

/**
 * Ticket di ingresso alla console, monouso e a breve scadenza.
 *
 * Serve a passare una sessione gia autenticata (frontend che possiede un JWT Accessi)
 * alla console amministrativa senza reinserire le credenziali e senza mettere il JWT
 * nell'URL: il frontend scambia il proprio JWT con un ticket opaco, apre la console
 * con `#entry=<ticket>` e la console lo scambia con il token originale.
 *
 * Il ticket e' valido una sola volta, per pochi secondi, ed e' legato all'utente che
 * lo ha richiesto (che deve avere accesso alla console). Resta in memoria del processo:
 * con piu istanze del backend il ticket va consumato dalla stessa istanza che lo emette.
 */

interface ConsoleEntryRecord {
  token: string;
  codiceUtente: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 5000;
const entries = new Map<string, ConsoleEntryRecord>();

export interface ConsoleEntryTicket {
  ticket: string;
  expiresInSeconds: number;
}

function sweep(now: number): void {
  for (const [ticket, record] of entries) {
    if (record.expiresAt <= now) entries.delete(ticket);
  }
}

/** Emette un ticket monouso per l'utente indicato, conservando il suo JWT per lo scambio. */
export function issueConsoleEntryTicket(
  record: { token: string; codiceUtente: number },
  ttlMs: number = DEFAULT_TTL_MS,
): ConsoleEntryTicket {
  const now = Date.now();
  sweep(now);

  // Limita la memoria anche sotto attacco: rimuove la voce piu vecchia.
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }

  const ticket = randomBytes(32).toString('hex');
  entries.set(ticket, { ...record, expiresAt: now + ttlMs });
  return { ticket, expiresInSeconds: Math.ceil(ttlMs / 1000) };
}

/** Consuma (monouso) un ticket e restituisce il JWT collegato, oppure null se scaduto/assente/invalido. */
export function consumeConsoleEntryTicket(
  ticket: unknown,
): { token: string; codiceUtente: number } | null {
  if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/i.test(ticket)) {
    return null;
  }
  const record = entries.get(ticket);
  if (!record) {
    return null;
  }
  entries.delete(ticket);
  if (record.expiresAt <= Date.now()) {
    return null;
  }
  return { token: record.token, codiceUtente: record.codiceUtente };
}

/** Solo per i test: azzera lo store in memoria. */
export function clearConsoleEntryTickets(): void {
  entries.clear();
}
