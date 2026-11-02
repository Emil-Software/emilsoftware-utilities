import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsString, ValidateNested } from 'class-validator';

export class Status {
  @ApiProperty({ example: '0', description: 'Codice di errore, "0" se tutto ok' })
  @IsString()
  errorCode!: string;

  @ApiProperty({ example: 'Success', description: 'Descrizione dell\'errore o successo' })
  @IsString()
  errorDescription!: string;
}

export abstract class BaseResponse {
  @ApiProperty({ type: Status })
  @ValidateNested()
  @Type(() => Status)
  @IsObject()
  Status!: Status;
}
