import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';

export class TipoFiltro {
  @ApiProperty({
    description: 'Identificativo del tipo di filtro',
    example: 1,
    type: Number,
  })
  @IsInt()
  @IsNotEmpty()
  tipFil!: number;

  @ApiProperty({
    description: 'Descrizione del filtro',
    example: 'Filtro standard',
    maxLength: 20,
    required: false,
  })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  desFil?: string;

  @ApiProperty({
    description: 'Campo associato al filtro',
    example: 'campoValore',
    maxLength: 20,
    required: false,
  })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  fldFil?: string;

  @ApiProperty({
    description: 'Filtro abilitato',
    example: 1,
    enum: [0, 1],
    required: false,
    default: 1,
  })
  @IsIn([0,1])
  @IsOptional()
  flgEnabled?: 0 | 1 = 1;
}

export class GetFiltriResponse extends BaseResponse {
      @ApiProperty({ type: TipoFiltro, isArray: true })
      @ValidateNested({ each: true })
      @Type(() => TipoFiltro)
    Result !: TipoFiltro[]
}

export class GetFiltriRequest {
    @ApiPropertyOptional({
        description: 'Mostra solo abilitati',
        enum: [0,1]
    })
    @IsOptional()
    @IsIn([0,1])
    @Type(() => Number)
    flgEnabled?: 0 | 1
}


