import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { StatusCode } from '../../Utilities';

/**
 * Creates the validation pipe used by every Accessi bootstrap path.
 *
 * It deliberately returns one stable, documented error contract instead of
 * Nest's default array. Consumers can branch on `code`; `details` is safe to
 * display or log because it contains only DTO field names and validation text.
 */
export function createAccessiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        severity: 'error',
        status: 400,
        statusCode: StatusCode.Error,
        code: 'ACCESSI_VALIDATION_ERROR',
        error: 'ACCESSI_VALIDATION_ERROR',
        message: 'La richiesta contiene dati non validi.',
        details: flattenValidationErrors(errors),
      }),
  });
}

/** Converts nested class-validator failures into deterministic client details. */
function flattenValidationErrors(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const ownMessages = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
    return [...ownMessages, ...flattenValidationErrors(error.children ?? [], path)];
  });
}
