import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';
import { TokenResult } from './TokenResult';

export class RefreshTokenRequest {
  @ApiProperty({ description: 'Refresh token emesso al login, 2FA o SSO.' })
  @IsString()
  refreshToken!: string;
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
