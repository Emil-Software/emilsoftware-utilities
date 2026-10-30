import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';
import { TokenResult } from './TokenResult';

export class RefreshTokenRequest {
  @ApiPropertyOptional({
    description: 'Refresh token emesso al login, 2FA o SSO. In modalita cookie puo essere omesso.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class RefreshTokenResult {
  @ApiProperty({ type: TokenResult, description: 'Nuovo access token.' })
  @ValidateNested()
  @Type(() => TokenResult)
  token!: TokenResult;

  @ApiPropertyOptional({ type: TokenResult, description: 'Nuovo refresh token, se abilitato.' })
  @ValidateNested()
  @Type(() => TokenResult)
  refreshToken?: TokenResult;
}

export class RefreshTokenResponse extends BaseResponse {
  @ApiProperty({ type: RefreshTokenResult })
  @ValidateNested()
  @Type(() => RefreshTokenResult)
  Result!: RefreshTokenResult;
}
