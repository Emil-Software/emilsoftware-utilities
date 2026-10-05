import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { BaseResponse } from './BaseResponse';

/** Esito dell'emissione di un ticket di ingresso alla console. */
export class ConsoleEntryTicketResult {
  @ApiProperty({
    description: 'Ticket monouso da usare in /api/accessi/console#entry=<ticket>.',
    example: 'f'.repeat(64),
  })
  ticket!: string;

  @ApiProperty({ description: 'Validita del ticket in secondi.', example: 60 })
  expiresInSeconds!: number;
}

export class ConsoleEntryTicketResponse extends BaseResponse {
  @ApiProperty({ type: ConsoleEntryTicketResult })
  Result!: ConsoleEntryTicketResult;
}

/** Body dello scambio del ticket. */
export class ConsoleEntryExchangeRequest {
  @ApiProperty({
    description: 'Ticket monouso restituito da POST /api/accessi/console/entry.',
    example: 'f'.repeat(64),
  })
  @IsString({ message: 'Il ticket deve essere una stringa.' })
  @Length(64, 64, { message: 'Il ticket deve essere lungo 64 caratteri.' })
  ticket!: string;
}

/** Sessione Accessi restituita dallo scambio, da usare come Bearer nella console. */
export class ConsoleEntryTokenResult {
  @ApiProperty({ description: 'JWT Accessi.', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  value!: string;

  @ApiProperty({ description: 'Schema di autorizzazione.', example: 'Bearer' })
  type!: string;
}

export class ConsoleEntrySessionResult {
  @ApiProperty({ type: ConsoleEntryTokenResult })
  token!: ConsoleEntryTokenResult;
}

export class ConsoleEntrySessionResponse extends BaseResponse {
  @ApiProperty({ type: ConsoleEntrySessionResult })
  Result!: ConsoleEntrySessionResult;
}
