import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';

/** Sezione di DDL (tabelle, generatori, chiavi esterne, indici, check, trigger). */
export class SchemaDdlSection {
  @ApiProperty({ example: 'tables' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Tabelle (18)' })
  @IsString()
  title!: string;

  @ApiProperty({ description: 'DDL della sezione.' })
  @IsString()
  sql!: string;
}

/** Schema DDL completo + entita presenti nel database. */
export class SchemaDdlResult {
  @ApiProperty({ description: 'Versione schema Accessi.', example: '1.11.0' })
  @IsString()
  version!: string;

  @ApiProperty({ type: [SchemaDdlSection] })
  @ValidateNested({ each: true })
  @Type(() => SchemaDdlSection)
  @IsArray()
  sections!: SchemaDdlSection[];

  @ApiProperty({ description: 'Script completo concatenato.' })
  @IsString()
  script!: string;

  @ApiProperty({ type: [String], description: 'Tabelle presenti nel database.' })
  @IsArray()
  @IsString({ each: true })
  presentTables!: string[];

  @ApiProperty({ type: [String], description: 'Tabelle presenti ma non di dominio Accessi.' })
  @IsArray()
  @IsString({ each: true })
  extraTables!: string[];

  @ApiProperty({ type: [String], description: 'Generatori presenti nel database.' })
  @IsArray()
  @IsString({ each: true })
  presentGenerators!: string[];
}

export class GetSchemaResponse extends BaseResponse {
  @ApiProperty({ type: SchemaDdlResult })
  @ValidateNested()
  @Type(() => SchemaDdlResult)
  Result!: SchemaDdlResult;
}
