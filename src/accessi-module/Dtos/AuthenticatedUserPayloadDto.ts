import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AuthenticatedUserPayloadDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  @Min(1)
  codiceUtente: number;

  @ApiPropertyOptional({ example: 'mario.rossi@dev.it' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  flagSuper: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  flagAdminConfigurator: boolean;

  @ApiProperty({ example: 1 })
  @IsInt()
  statoRegistrazione: number;
}

export class AuthenticatedTokenPayloadDto {
  @ApiProperty({ type: AuthenticatedUserPayloadDto })
  userData: AuthenticatedUserPayloadDto;
}
