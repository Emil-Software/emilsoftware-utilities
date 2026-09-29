import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';

/** Richiesta di bootstrap del primo admin: il token e quello stampato nel log di avvio. */
export class BootstrapAdminRequest {
  @ApiProperty({ description: 'Token di bootstrap stampato nel log di avvio del backend.' })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'admin@example.com' })
  @IsString()
  email!: string;

  @ApiPropertyOptional({ example: 'Mario' })
  @IsOptional()
  @IsString()
  nome?: string;

  @ApiPropertyOptional({ example: 'Rossi' })
  @IsOptional()
  @IsString()
  cognome?: string;

  @ApiPropertyOptional({ description: 'Password da impostare. Se assente viene generata e restituita una sola volta.' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'Crea anche un superutente (tutte le abilitazioni). Default true.' })
  @IsOptional()
  @IsBoolean()
  superUser?: boolean;
}

export class BootstrapAdminResultDto {
  @ApiProperty({ example: 1 })
  codiceUtente!: number;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiPropertyOptional({ description: 'Password generata: presente solo se non e stata fornita nella richiesta.' })
  password?: string;

  @ApiProperty({ example: true })
  passwordGenerated!: boolean;
}

export class BootstrapAdminResponse extends BaseResponse {
  @ApiProperty({ type: BootstrapAdminResultDto })
  @ValidateNested()
  @Type(() => BootstrapAdminResultDto)
  Result!: BootstrapAdminResultDto;
}
