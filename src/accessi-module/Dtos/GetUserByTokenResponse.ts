import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';
import { AuthenticatedTokenPayloadDto } from './AuthenticatedUserPayloadDto';

export class GetUserByTokenResponse extends BaseResponse {
  @ApiProperty({ type: AuthenticatedTokenPayloadDto })
  @ValidateNested()
  @Type(() => AuthenticatedTokenPayloadDto)
  Result: AuthenticatedTokenPayloadDto;
}
