import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, Min } from 'class-validator';
import { StatoRegistrazione } from './StatoRegistrazione';

export class SetStatoRegistrazioneDto {
  @ApiProperty({
    description: "Codice identificativo dell'utente",
    example: 123,
  })
  @Type(() => Number)
  @IsInt({ message: 'Il codice utente deve essere un intero.' })
  @Min(1, { message: 'Il codice utente deve essere maggiore di zero.' })
  codiceUtente: number;

  @ApiProperty({
    description: 'Nuovo stato di registrazione',
    enum: StatoRegistrazione,
    example: StatoRegistrazione.DELETE,
  })
  @IsEnum(StatoRegistrazione, { message: 'Lo stato di registrazione non e valido.' })
  statoRegistrazione: StatoRegistrazione;
}
