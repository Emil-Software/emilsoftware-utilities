import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { RuoliMenu } from './RuoliMenu';

export class Role {
  @ApiPropertyOptional({ description: 'Codice univoco del ruolo', required: false, type: Number, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Il codice ruolo deve essere un intero.' })
  codiceRuolo?: number;

  @ApiProperty({ description: 'Descrizione del ruolo' })
  @IsString({ message: 'La descrizione del ruolo deve essere una stringa.' })
  @Length(1, 255, { message: 'La descrizione del ruolo deve essere compresa tra 1 e 255 caratteri.' })
  descrizioneRuolo: string;

  @ApiProperty({
    description: 'Lista di menu associati al ruolo',
    type: [RuoliMenu],
  })
  @IsArray({ message: 'I menu del ruolo devono essere un array.' })
  @ArrayNotEmpty({ message: 'Il ruolo deve contenere almeno un menu.' })
  @ValidateNested({ each: true })
  @Type(() => RuoliMenu)
  menu: RuoliMenu[];
}
