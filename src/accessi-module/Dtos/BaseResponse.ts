import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class Status {
  @ApiProperty({ example: '0', description: 'Codice di errore, "0" se tutto ok' })
  @IsString()
  errorCode: string;

  @ApiProperty({ example: 'Success', description: 'Descrizione dell\'errore o successo' })
  @IsString()
  errorDescription: string;
}

export abstract class BaseResponse {
  @ApiProperty({ type: Status })
  @ValidateNested()
  @Type(() => Status)
  @IsObject()
  Status: Status;

  @ApiPropertyOptional({
    example: 'Dati recuperati con successo.',
    description: 'Messaggio informativo restituito dalla libreria quando presente.',
  })
  @IsOptional()
  @IsString()
  Message?: string;
}

export class ActionResponse {
  @ApiProperty({ example: 'success' })
  @IsString()
  severity: string;

  @ApiProperty({ example: 200 })
  @IsNumber()
  status: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  statusCode: number;

  @ApiProperty({ example: 'Operazione completata con successo.' })
  @IsString()
  message: string;
}

export class ErrorResponse {
  @ApiProperty({ example: 'error' })
  @IsString()
  severity: string;

  @ApiProperty({ example: 400 })
  @IsNumber()
  status: number;

  @ApiProperty({ example: 2 })
  @IsNumber()
  statusCode: number;

  @ApiProperty({ example: 'An error occurred' })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    example: 'ACCESSI_DATABASE_SCHEMA_OUTDATED',
    description: 'Codice stabile leggibile dal client. Non contiene dettagli tecnici o dati sensibili.',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({
    example: 'ACCESSI_REQUEST_ERROR',
    description: 'Campo legacy che riporta il codice stabile dell errore, senza SQL o stack trace.',
  })
  @IsString()
  error: string;

  @ApiPropertyOptional({
    example: ['email: deve essere una stringa.'],
    description: 'Dettagli di validazione sicuri, presenti solo per ACCESSI_VALIDATION_ERROR.',
    type: [String],
  })
  @IsOptional()
  @IsString({ each: true })
  details?: string[];
}

export class PasswordExpiredResponse {
  @ApiProperty({ example: 'warning' })
  @IsString()
  severity: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  statusCode: number;

  @ApiProperty({ example: 'PASSWORD_EXPIRED' })
  @IsString()
  code: string;

  @ApiProperty({ example: "Password scaduta. E' necessario aggiornarla" })
  @IsString()
  message: string;
}
