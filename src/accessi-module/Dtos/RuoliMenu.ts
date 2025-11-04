import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { TipoAbilitazione } from './TipoAbilitazione';

export class RuoliMenu {
  @ApiPropertyOptional({
    description: 'Codice Ruolo',
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  codiceRuolo?: number;

  @ApiProperty({
    description: 'Codice univoco del menu',
    example: 'MNUELENCOCLIENTI',
  })
  @IsString()
  @IsNotEmpty({ message: 'Il codice menu è obbligatorio.' })
  codiceMenu: string;

  @ApiProperty({
    description: 'Tipo di abilitazione',
    enum: TipoAbilitazione,
    example: TipoAbilitazione.LETTURA,
  })
  @IsEnum(TipoAbilitazione, { message: 'Il tipo di abilitazione non è valido.' })
  tipoAbilitazione: TipoAbilitazione;
}
