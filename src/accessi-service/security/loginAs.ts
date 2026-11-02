import { BadRequestException } from '@nestjs/common';

/** Nome del query parameter usato dalle applicazioni per consumare il token. */
export const LOGIN_AS_QUERY_PARAM = 'loginAsToken';

/**
 * Combina l'URL dell'applicazione con il token di accesso temporaneo.
 * Accetta solo URL assoluti http/https: evita schemi come javascript: o data:
 * che verrebbero restituiti alla console come link cliccabile.
 */
export function buildLoginAsUrl(targetUrl: string, token: string): string {
  if (typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    throw new BadRequestException({
      code: 'ACCESSI_LOGIN_AS_INVALID_URL',
      message: 'Indica l URL dell applicazione a cui accedere.',
    });
  }
  if (typeof token !== 'string' || token.trim() === '') {
    throw new BadRequestException({
      code: 'ACCESSI_LOGIN_AS_INVALID_TOKEN',
      message: 'Token di accesso temporaneo non valido.',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    throw new BadRequestException({
      code: 'ACCESSI_LOGIN_AS_INVALID_URL',
      message: 'L URL deve essere assoluto e valido, per esempio https://app.example.com.',
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException({
      code: 'ACCESSI_LOGIN_AS_INVALID_URL',
      message: 'L URL deve usare http o https.',
    });
  }

  parsed.searchParams.set(LOGIN_AS_QUERY_PARAM, token);
  return parsed.toString();
}
