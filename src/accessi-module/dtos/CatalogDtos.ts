import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseResponse } from './BaseResponse';

/**
 * DTO di gestione dei cataloghi di configurazione (menu, gruppi, tipi menu, tipi filtro).
 * I codici sono chiavi primarie immutabili: vengono valorizzati in creazione e passati come path in modifica.
 */

// ---------------------------------------------------------------------------
// Tipi menu (MENU_TIPI)
// ---------------------------------------------------------------------------

export class MenuTypeEntity {
  @ApiProperty({ description: 'Codice del tipo menu (1 carattere).', example: 'A' })
  codiceTipo!: string;

  @ApiPropertyOptional({ description: 'Descrizione del tipo menu.', example: 'Amministrazione' })
  descrizioneTipo?: string;
}

export class GetMenuTypesResponse extends BaseResponse {
  @ApiProperty({ type: [MenuTypeEntity] })
  @ValidateNested({ each: true })
  @Type(() => MenuTypeEntity)
  Result!: MenuTypeEntity[];
}

export class CreateMenuTypeRequest {
  @ApiProperty({ description: 'Codice del tipo menu (1 carattere).', example: 'A', maxLength: 1 })
  @IsString({ message: 'Il codice tipo deve essere una stringa.' })
  @IsNotEmpty({ message: 'Il codice tipo e obbligatorio.' })
  @MaxLength(1, { message: 'Il codice tipo non puo superare 1 carattere.' })
  codiceTipo!: string;

  @ApiPropertyOptional({ description: 'Descrizione del tipo menu.', example: 'Amministrazione', maxLength: 20 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'La descrizione non puo superare 20 caratteri.' })
  descrizioneTipo?: string;
}

export class UpdateMenuTypeRequest {
  @ApiPropertyOptional({ description: 'Descrizione del tipo menu.', example: 'Amministrazione', maxLength: 20 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'La descrizione non puo superare 20 caratteri.' })
  descrizioneTipo?: string;
}

// ---------------------------------------------------------------------------
// Gruppi menu (MENU_GRP)
// ---------------------------------------------------------------------------

export class CreateMenuGroupRequest {
  @ApiProperty({ description: 'Codice del gruppo (1 carattere).', example: 'A', maxLength: 1 })
  @IsString({ message: 'Il codice gruppo deve essere una stringa.' })
  @IsNotEmpty({ message: 'Il codice gruppo e obbligatorio.' })
  @MaxLength(1, { message: 'Il codice gruppo non puo superare 1 carattere.' })
  codiceGruppo!: string;

  @ApiPropertyOptional({ description: 'Descrizione del gruppo.', example: 'Gestione Accessi', maxLength: 100 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(100, { message: 'La descrizione non puo superare 100 caratteri.' })
  descrizioneGruppo?: string;

  @ApiPropertyOptional({ description: 'Ordine di visualizzazione del gruppo.', example: 1, type: Number })
  @IsInt({ message: "L'ordine deve essere un intero." })
  @IsOptional()
  @Type(() => Number)
  ordineGruppo?: number;

  @ApiPropertyOptional({ description: 'Gruppo abilitato.', example: true, type: Boolean })
  @IsBoolean({ message: 'Il flag enabled deve essere booleano.' })
  @IsOptional()
  enabled?: boolean;
}

export class UpdateMenuGroupRequest {
  @ApiPropertyOptional({ description: 'Descrizione del gruppo.', example: 'Gestione Accessi', maxLength: 100 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(100, { message: 'La descrizione non puo superare 100 caratteri.' })
  descrizioneGruppo?: string;

  @ApiPropertyOptional({ description: 'Ordine di visualizzazione del gruppo.', example: 1, type: Number })
  @IsInt({ message: "L'ordine deve essere un intero." })
  @IsOptional()
  @Type(() => Number)
  ordineGruppo?: number;

  @ApiPropertyOptional({ description: 'Gruppo abilitato.', example: true, type: Boolean })
  @IsBoolean({ message: 'Il flag enabled deve essere booleano.' })
  @IsOptional()
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Menu (MENU)
// ---------------------------------------------------------------------------

export class CreateMenuRequest {
  @ApiProperty({ description: 'Codice univoco del menu.', example: 'MNU001', maxLength: 20 })
  @IsString({ message: 'Il codice menu deve essere una stringa.' })
  @IsNotEmpty({ message: 'Il codice menu e obbligatorio.' })
  @MaxLength(20, { message: 'Il codice menu non puo superare 20 caratteri.' })
  codiceMenu!: string;

  @ApiPropertyOptional({ description: 'Descrizione del menu.', example: 'Gestione Utenti', maxLength: 100 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(100, { message: 'La descrizione non puo superare 100 caratteri.' })
  descrizioneMenu?: string;

  @ApiProperty({ description: 'Codice del gruppo di appartenenza.', example: 'A', maxLength: 1 })
  @IsString({ message: 'Il codice gruppo deve essere una stringa.' })
  @IsNotEmpty({ message: 'Il codice gruppo e obbligatorio.' })
  @MaxLength(1, { message: 'Il codice gruppo non puo superare 1 carattere.' })
  codiceGruppo!: string;

  @ApiPropertyOptional({ description: 'Codice del tipo menu.', example: 'A', maxLength: 1 })
  @IsString({ message: 'Il tipo menu deve essere una stringa.' })
  @IsOptional()
  @MaxLength(1, { message: 'Il tipo menu non puo superare 1 carattere.' })
  tipo?: string;

  @ApiPropertyOptional({ description: "Percorso dell'icona.", example: 'fa-users', maxLength: 50 })
  @IsString({ message: "L'icona deve essere una stringa." })
  @IsOptional()
  @MaxLength(50, { message: "L'icona non puo superare 50 caratteri." })
  icona?: string;

  @ApiPropertyOptional({ description: 'Pagina associata al menu.', example: '/accessi/gestione-utenti', maxLength: 50 })
  @IsString({ message: 'La pagina deve essere una stringa.' })
  @IsOptional()
  @MaxLength(50, { message: 'La pagina non puo superare 50 caratteri.' })
  pagina?: string;

  @ApiPropertyOptional({ description: 'Ordine di visualizzazione del menu.', example: 1, type: Number })
  @IsInt({ message: "L'ordine deve essere un intero." })
  @IsOptional()
  @Type(() => Number)
  ordineMenu?: number;

  @ApiPropertyOptional({ description: 'Menu abilitato.', example: true, type: Boolean })
  @IsBoolean({ message: 'Il flag enabled deve essere booleano.' })
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Menu di riferimento (gerarchia).', example: 'MNU000', maxLength: 20 })
  @IsString({ message: 'Il menu di riferimento deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'Il menu di riferimento non puo superare 20 caratteri.' })
  rifMenu?: string;

  @ApiPropertyOptional({ description: 'Nota informativa associata al menu.', example: 'Visibile solo agli amministratori', maxLength: 1000 })
  @IsString({ message: 'La nota deve essere una stringa.' })
  @IsOptional()
  @MaxLength(1000, { message: 'La nota non puo superare 1000 caratteri.' })
  note?: string;
}

export class UpdateMenuRequest {
  @ApiPropertyOptional({ description: 'Descrizione del menu.', example: 'Gestione Utenti', maxLength: 100 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(100, { message: 'La descrizione non puo superare 100 caratteri.' })
  descrizioneMenu?: string;

  @ApiPropertyOptional({ description: 'Codice del gruppo di appartenenza.', example: 'A', maxLength: 1 })
  @IsString({ message: 'Il codice gruppo deve essere una stringa.' })
  @IsOptional()
  @MaxLength(1, { message: 'Il codice gruppo non puo superare 1 carattere.' })
  codiceGruppo?: string;

  @ApiPropertyOptional({ description: 'Codice del tipo menu.', example: 'A', maxLength: 1 })
  @IsString({ message: 'Il tipo menu deve essere una stringa.' })
  @IsOptional()
  @MaxLength(1, { message: 'Il tipo menu non puo superare 1 carattere.' })
  tipo?: string;

  @ApiPropertyOptional({ description: "Percorso dell'icona.", example: 'fa-users', maxLength: 50 })
  @IsString({ message: "L'icona deve essere una stringa." })
  @IsOptional()
  @MaxLength(50, { message: "L'icona non puo superare 50 caratteri." })
  icona?: string;

  @ApiPropertyOptional({ description: 'Pagina associata al menu.', example: '/accessi/gestione-utenti', maxLength: 50 })
  @IsString({ message: 'La pagina deve essere una stringa.' })
  @IsOptional()
  @MaxLength(50, { message: 'La pagina non puo superare 50 caratteri.' })
  pagina?: string;

  @ApiPropertyOptional({ description: 'Ordine di visualizzazione del menu.', example: 1, type: Number })
  @IsInt({ message: "L'ordine deve essere un intero." })
  @IsOptional()
  @Type(() => Number)
  ordineMenu?: number;

  @ApiPropertyOptional({ description: 'Menu abilitato.', example: true, type: Boolean })
  @IsBoolean({ message: 'Il flag enabled deve essere booleano.' })
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Menu di riferimento (gerarchia).', example: 'MNU000', maxLength: 20 })
  @IsString({ message: 'Il menu di riferimento deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'Il menu di riferimento non puo superare 20 caratteri.' })
  rifMenu?: string;

  @ApiPropertyOptional({ description: 'Nota informativa associata al menu.', example: 'Visibile solo agli amministratori', maxLength: 1000 })
  @IsString({ message: 'La nota deve essere una stringa.' })
  @IsOptional()
  @MaxLength(1000, { message: 'La nota non puo superare 1000 caratteri.' })
  note?: string;
}

// ---------------------------------------------------------------------------
// Tipi filtro (FILTRI_TIPO)
// ---------------------------------------------------------------------------

export class CreateFilterTypeRequest {
  @ApiProperty({ description: 'Identificativo del tipo di filtro.', example: 1, type: Number })
  @IsInt({ message: 'Il codice tipo filtro deve essere un intero.' })
  @Type(() => Number)
  tipFil!: number;

  @ApiPropertyOptional({ description: 'Descrizione del filtro.', example: 'Filtro standard', maxLength: 20 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'La descrizione non puo superare 20 caratteri.' })
  desFil?: string;

  @ApiPropertyOptional({ description: 'Campo associato al filtro.', example: 'CODCLI', maxLength: 20 })
  @IsString({ message: 'Il campo deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'Il campo non puo superare 20 caratteri.' })
  fldFil?: string;

  @ApiPropertyOptional({ description: 'Filtro abilitato.', example: 1, enum: [0, 1], default: 1 })
  @IsIn([0, 1], { message: 'Il flag abilitato deve essere 0 o 1.' })
  @IsOptional()
  flgEnabled?: 0 | 1;
}

export class UpdateFilterTypeRequest {
  @ApiPropertyOptional({ description: 'Descrizione del filtro.', example: 'Filtro standard', maxLength: 20 })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'La descrizione non puo superare 20 caratteri.' })
  desFil?: string;

  @ApiPropertyOptional({ description: 'Campo associato al filtro.', example: 'CODCLI', maxLength: 20 })
  @IsString({ message: 'Il campo deve essere una stringa.' })
  @IsOptional()
  @MaxLength(20, { message: 'Il campo non puo superare 20 caratteri.' })
  fldFil?: string;

  @ApiPropertyOptional({ description: 'Filtro abilitato.', example: 1, enum: [0, 1], default: 1 })
  @IsIn([0, 1], { message: 'Il flag abilitato deve essere 0 o 1.' })
  @IsOptional()
  flgEnabled?: 0 | 1;
}
