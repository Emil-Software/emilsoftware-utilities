import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class TwoFactorChallengeDto {
  @ApiProperty({ enum: [true], description: 'Il login non e completo: nessun JWT e stato emesso.' })
  twoFactorRequired: true = true;

  @ApiProperty({ description: 'Identificativo opaco della verifica, non utilizzabile come Bearer token.' })
  challengeId: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  @ApiProperty({ example: 60, description: 'Secondi minimi prima del prossimo reinvio.' })
  resendAfterSeconds: number;

  @ApiProperty({ enum: ['email'] })
  method: 'email' = 'email';
}

export class ResendTwoFactorRequest {
  @ApiProperty({ minLength: 64, maxLength: 64 })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  challengeId: string;
}

export class VerifyTwoFactorRequest extends ResendTwoFactorRequest {
  @ApiProperty({ description: 'Codice monouso ricevuto via email.', example: '012345', pattern: '^\\d{6}$' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Il codice deve contenere 6 cifre.' })
  code: string;
}
