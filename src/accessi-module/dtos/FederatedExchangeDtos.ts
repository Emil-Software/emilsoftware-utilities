import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, Length, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';
import { LoginResult } from './LoginResponse';
import { TokenResult } from './TokenResult';

/**
 * Identita esterna gia verificata dal backend fratello.
 *
 * Accessi non riceve token del provider: il backend valida firma/issuer/audience
 * e passa solo la coppia stabile provider + subject.
 */
export class ExchangeFederatedIdentityRequest {
  @ApiProperty({
    example: 'azure-ad-acme-produzione',
    description: 'Chiave provider censita in Accessi. Non e il nome commerciale del provider.',
  })
  @IsString()
  @Length(1, 64)
  provider!: string;

  @ApiProperty({
    example: 'a1b2c3d4-...',
    description: 'ID stabile dell account presso il provider: oid, sub o NameID persistente. Non usare email o username.',
  })
  @IsString()
  @Length(1, 512)
  subject!: string;
}

export class FederatedAuthenticationResultDto {
  @ApiProperty({ example: 123 })
  codiceUtente!: number;

  @ApiProperty({ type: LoginResult, description: 'Profilo, grant e token della sessione Accessi.' })
  @ValidateNested()
  @Type(() => LoginResult)
  login!: LoginResult;

  @ApiPropertyOptional({ type: TokenResult, description: 'Assente quando login.challenge richiede la verifica 2FA.' })
  @ValidateNested()
  @Type(() => TokenResult)
  token?: TokenResult;
}

export class FederatedExchangeResponse extends BaseResponse {
  @ApiProperty({ type: FederatedAuthenticationResultDto })
  @ValidateNested()
  @Type(() => FederatedAuthenticationResultDto)
  Result!: FederatedAuthenticationResultDto;
}
