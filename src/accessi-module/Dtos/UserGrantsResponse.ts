import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';
import { UserGrantsDto } from './UserGrantsDto';

export class UserGrantsResponse extends BaseResponse {
  @ApiProperty({ type: UserGrantsDto })
  @ValidateNested()
  @Type(() => UserGrantsDto)
  Result: UserGrantsDto;
}
