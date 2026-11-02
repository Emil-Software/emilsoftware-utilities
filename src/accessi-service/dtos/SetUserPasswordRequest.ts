import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** Impostazione diretta della password di un utente da parte di un admin. */
export class SetUserPasswordRequest {
  @ApiProperty({
    description: "Nuova password in chiaro: almeno 8 caratteri con maiuscola, minuscola, cifra e carattere speciale, senza spazi e non comune. Viene hashata e non restituita; se non conforme l API risponde 400 con codice ACCESSI_WEAK_PASSWORD.",
    minLength: 8,
    maxLength: 100,
    example: 'PasswordSicura123!',
  })
  @IsString({ message: 'La nuova password deve essere una stringa.' })
  @Length(8, 100, {
    message: 'La nuova password deve essere compresa tra 8 e 100 caratteri.',
  })
  newPassword!: string;
}
