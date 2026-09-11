import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { RestUtilities, StatusCode } from '../../Utilities';

type ExceptionPayload = {
  code?: string;
  error?: string;
  message?: string | string[];
  details?: string[];
};

/**
 * Finalizes every exception raised before an Accessi controller can reply.
 *
 * This includes invalid JSON, validation-pipe errors and guard failures. The
 * filter deliberately never return SQL, stack traces or provider diagnostics.
 */
@Catch()
export class AccessiHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : RestUtilities.isDatabaseSchemaError(exception)
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = this.getPayload(exception);
    const invalidJson = status === HttpStatus.BAD_REQUEST && this.isInvalidJson(exception, payload);
    const explicitMessage = typeof payload.message === 'string' ? payload.message : undefined;
    const code = payload.code
      ?? (RestUtilities.isDatabaseSchemaError(exception)
        ? 'ACCESSI_DATABASE_SCHEMA_OUTDATED'
        : invalidJson
          ? 'ACCESSI_INVALID_JSON'
          : status === HttpStatus.BAD_REQUEST
            ? 'ACCESSI_REQUEST_ERROR'
            : status === HttpStatus.UNAUTHORIZED
              ? 'ACCESSI_UNAUTHORIZED'
              : status === HttpStatus.FORBIDDEN
                ? 'ACCESSI_FORBIDDEN'
                : 'ACCESSI_INTERNAL_ERROR');

    const message = code === 'ACCESSI_VALIDATION_ERROR'
      ? 'La richiesta contiene dati non validi.'
      : code === 'ACCESSI_DATABASE_SCHEMA_OUTDATED'
        ? 'Lo schema del database Accessi non e aggiornato. Eseguire la migrazione database e riprovare.'
        : invalidJson
          ? 'Il corpo della richiesta non contiene JSON valido.'
          : explicitMessage ?? (status === HttpStatus.UNAUTHORIZED
            ? 'Autenticazione non valida o scaduta.'
            : status === HttpStatus.FORBIDDEN
              ? 'Operazione non autorizzata.'
              : status >= HttpStatus.INTERNAL_SERVER_ERROR
                ? 'Errore interno del modulo Accessi.'
                : 'Richiesta non valida.');

    response.status(status).json({
      severity: 'error',
      status,
      statusCode: StatusCode.Error,
      code,
      error: code,
      message,
      ...(payload.details?.length ? { details: payload.details } : {}),
    });
  }

  private getPayload(exception: unknown): ExceptionPayload {
    if (!(exception instanceof HttpException)) return {};
    const response = exception.getResponse();
    return typeof response === 'string' ? { message: response } : response as ExceptionPayload;
  }

  private isInvalidJson(exception: unknown, payload: ExceptionPayload): boolean {
    const message = exception instanceof Error ? exception.message : payload.message;
    const text = Array.isArray(message) ? message.join(' ') : String(message ?? '');
    return /json|unexpected token|expected property name|unterminated string/i.test(text);
  }
}
