import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TipoAbilitazione } from "./TipoAbilitazione";
import { IsEnum, IsNotEmpty, IsString, Length, IsOptional } from "class-validator";

export class AbilitazioneMenu {
  
  @ApiProperty({
    description: 'Codice univoco del menu',
    example: 'MNUELENCOCLIENTI'
  })
  @IsString()
  @IsNotEmpty({ message: "Il codice menu è obbligatorio." })
  @Length(3, 20, { message: "Il codice menu deve essere tra 3 e 20 caratteri." })
  codiceMenu: string;

  @ApiPropertyOptional({
    description: 'Tipo di abilitazione',
    enum: TipoAbilitazione,
    example: TipoAbilitazione.SCRITTURA
  })
  @IsEnum(TipoAbilitazione, { message: "Il tipo di abilitazione non è valido." })
  tipoAbilitazione?: TipoAbilitazione;

  @ApiPropertyOptional({
    description: 'Descrizione del menu',
    example: 'Lista Clienti'
  })
  @IsString()
  @IsNotEmpty({ message: "La descrizione del menu è obbligatoria." })
  descrizioneMenu?: string;

  @ApiPropertyOptional({
    description: 'Descrizione del gruppo a cui appartiene il menu',
    example: 'Amministrazione'
  })
  @IsString()
  @IsNotEmpty({ message: "La descrizione del gruppo è obbligatoria." })
  descrizioneGruppo?: string;

  @ApiPropertyOptional({
    description: 'Codice univoco del gruppo a cui appartiene il menu',
    example: 'C'
  })
  @IsString()
  @IsNotEmpty({ message: "Il codice gruppo è obbligatorio." })
  codiceGruppo?: string;

  @ApiPropertyOptional({
    description: 'Nome dell\'icona associata al menu',
    example: 'people'
  })
  @IsString()
  @IsOptional()
  icona?: string | null;

  @ApiPropertyOptional({
    description: 'Tipo di menu',
    example: 'M'
  })
  @IsString()
  @IsOptional()
  tipo?: string | null;

  @ApiPropertyOptional({
    description: 'Percorso della pagina associata al menu',
    example: '/lista-clienti'
  })
  @IsString()
  @IsOptional()
  pagina?: string | null;
}
