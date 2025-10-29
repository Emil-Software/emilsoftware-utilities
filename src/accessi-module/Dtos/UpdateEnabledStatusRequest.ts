import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';

export class UpdateEnabledStatusRequest {
  @ApiProperty({
    description: "Codice utente che richiede l'aggiornamento",
    example: 12345,
  })
  @IsInt({ message: 'Il codice utente deve essere un numero intero.' })
  @Min(1, { message: 'Il codice utente deve essere positivo.' })
  codiceUtente: number;

  @ApiProperty({
    description: 'Nuovo stato di abilitazione',
    example: true,
    type: Boolean,
  })
  @IsBoolean({ message: 'Il valore di enabled deve essere booleano.' })
  enabled: boolean;
}
