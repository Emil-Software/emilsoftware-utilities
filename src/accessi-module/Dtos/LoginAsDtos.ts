import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { BaseResponse } from './BaseResponse';

/** Body per generare un URL di accesso temporaneo come un altro utente. */
export class LoginAsRequest {
  @ApiProperty({
    description: 'URL assoluto (http/https) dell applicazione a cui accedere.',
    example: 'https://app.example.com/dashboard',
  })
  @IsString({ message: 'L URL deve essere una stringa.' })
  @Length(1, 2048, { message: 'L URL deve essere compreso tra 1 e 2048 caratteri.' })
  url!: string;
}

/** Esito della generazione dell'URL di impersonazione. */
export class LoginAsResult {
  @ApiProperty({
    description: 'URL dell applicazione con il token allegato come query parameter loginAsToken.',
    example: 'https://app.example.com/dashboard?loginAsToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  loginUrl!: string;

  @ApiProperty({
    description: 'Token JWT di accesso temporaneo per l utente target.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token!: string;

  @ApiProperty({
    description: 'Validita del token in secondi, la stessa della sessione Accessi standard.',
    example: 86400,
  })
  expiresInSeconds!: number;

  @ApiProperty({
    description: 'Scadenza del token in formato ISO 8601.',
    example: '2026-10-23T14:05:00.000Z',
  })
  expiresAt!: string;
}

export class LoginAsResponse extends BaseResponse {
  @ApiProperty({ type: LoginAsResult })
  Result!: LoginAsResult;
}
