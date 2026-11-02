import { ApiProperty } from '@nestjs/swagger';
import { BaseResponse } from './BaseResponse';
import { Role } from './Role';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

export class GetRolesResponse extends BaseResponse {
  @ApiProperty({ type: [Role] })
  @ValidateNested({ each: true })
  @Type(() => Role)
  Result!: Role[];
}
