import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class SendResetPasswordEmailRequest {
  @ApiProperty({
    description: "L'email dell'utente che richiede il reset.",
    example: 'mario.rossi@dev.it',
  })
  @IsString()
  @Length(3, 254)
  email: string;

  @ApiPropertyOptional({
    description: 'HTML personalizzato della mail di reset, se gestito dal chiamante.',
    example: '<html><body>Reset password</body></html>',
  })
  @IsOptional()
  @IsString()
  htmlMail?: string;
}
