import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { BaseResponse } from '../BaseResponse';
import { AllegatoDto } from '../AllegatoDto';

export class GetListResponse extends BaseResponse {
  @ApiProperty({ type: [AllegatoDto] })
  @ValidateNested({ each: true })
  @Type(() => AllegatoDto)
  Result!: AllegatoDto[];
}
