import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ConfirmResetPasswordRequest {
  @ApiProperty({
    description: 'Nuova password da impostare.',
    minLength: 8,
    maxLength: 100,
    example: 'PasswordSicura123!',
  })
  @IsString({ message: 'La nuova password deve essere una stringa.' })
  @Length(8, 100, {
    message: 'La nuova password deve essere compresa tra 8 e 100 caratteri.',
  })
  newPassword: string;
}
