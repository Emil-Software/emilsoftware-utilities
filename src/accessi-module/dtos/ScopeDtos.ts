import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseResponse } from './BaseResponse';

/**
 * Scope applicativi: etichette che decidono in quali applicazioni un menu e
 * visibile. Il codice e la chiave stabile usata dalle API (`?scope=STEX`).
 */
export class ScopeEntity {
  @ApiProperty({ description: 'Codice dello scope.', example: 'STEX' })
  codice!: string;

  @ApiProperty({ description: 'Nome leggibile dello scope.', example: 'SteX' })
  nome!: string;
}

export class GetScopesResponse extends BaseResponse {
  @ApiProperty({ type: [ScopeEntity] })
  @ValidateNested({ each: true })
  @Type(() => ScopeEntity)
  Result!: ScopeEntity[];
}

export class CreateScopeRequest {
  @ApiProperty({ description: 'Codice univoco dello scope.', example: 'STEX', maxLength: 20 })
  @IsString({ message: 'Il codice scope deve essere una stringa.' })
  @IsNotEmpty({ message: 'Il codice scope e obbligatorio.' })
  @MaxLength(20, { message: 'Il codice scope non puo superare 20 caratteri.' })
  codice!: string;

  @ApiProperty({ description: 'Nome leggibile dello scope.', example: 'SteX', maxLength: 100 })
  @IsString({ message: 'Il nome scope deve essere una stringa.' })
  @IsNotEmpty({ message: 'Il nome scope e obbligatorio.' })
  @MaxLength(100, { message: 'Il nome scope non puo superare 100 caratteri.' })
  nome!: string;
}

export class UpdateScopeRequest {
  @ApiPropertyOptional({ description: 'Nome leggibile dello scope.', example: 'SteX', maxLength: 100 })
  @IsString({ message: 'Il nome scope deve essere una stringa.' })
  @IsOptional()
  @MaxLength(100, { message: 'Il nome scope non puo superare 100 caratteri.' })
  nome?: string;
}

export class SetMenuScopesRequest {
  @ApiProperty({
    description: 'Elenco completo degli scope associati al menu.',
    example: ['STEX', 'TINTEMIX'],
    type: [String],
  })
  @IsArray({ message: 'Gli scope devono essere un array.' })
  @ArrayUnique({ message: 'Gli scope non devono contenere duplicati.' })
  @IsString({ each: true, message: 'Ogni scope deve essere una stringa.' })
  scopes!: string[];
}

export class SetScopeMenusRequest {
  @ApiProperty({
    description: 'Elenco completo dei menu associati allo scope.',
    example: ['MNUMAIN', 'MNUUTENTI'],
    type: [String],
  })
  @IsArray({ message: 'I menu devono essere un array.' })
  @ArrayUnique({ message: 'I menu non devono contenere duplicati.' })
  @IsString({ each: true, message: 'Ogni menu deve essere una stringa.' })
  menu!: string[];
}

export class GetMenuScopesResponse extends BaseResponse {
  @ApiProperty({ type: [String], description: 'Codici degli scope associati al menu.' })
  Result!: string[];
}
