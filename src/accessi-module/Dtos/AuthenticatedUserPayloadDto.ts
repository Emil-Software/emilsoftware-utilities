import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AuthenticatedUserPayloadDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  @Min(1)
  codiceUtente!: number;

  @ApiPropertyOptional({ example: 'mario.rossi@dev.it' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  flagSuper!: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  flagAdmin!: boolean;

  @ApiPropertyOptional({ description: 'Verifica email richiesta per questo utente.', default: false })
  @IsOptional()
  @IsBoolean()
  flagDueFattori?: boolean;

  @ApiPropertyOptional({ description: 'Accesso consentito con il solo codice email.', default: false })
  @IsOptional()
  @IsBoolean()
  passwordlessLoginEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Policy di login locale preesistente.', default: true })
  @IsOptional()
  @IsBoolean()
  passwordLoginEnabled?: boolean;

  @ApiProperty({ example: 1 })
  @IsInt()
  statoRegistrazione!: number;
}

export class AuthenticatedTokenPayloadDto {
  @ApiProperty({ type: AuthenticatedUserPayloadDto })
  userData!: AuthenticatedUserPayloadDto;
}
