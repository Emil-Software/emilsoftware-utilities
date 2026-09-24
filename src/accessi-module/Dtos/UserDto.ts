import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { StatoRegistrazione } from './StatoRegistrazione';
import { Permission } from './Permission';
import { TipoAbilitazione } from './TipoAbilitazione';
import { FiltriUtente } from './FiltriUtente';

/**
 * Profilo Accessi con dati anagrafici, policy di accesso e filtri legacy.
 * I campi amministrativi (`flagSuper`, `flagAdminConfigurator`, ruoli, grant e policy password) devono essere
 * accettati soltanto da endpoint e flussi backend esplicitamente privilegiati.
 */
export class UserDto extends OmitType(FiltriUtente, ['codUte'] as const) {
  @ApiProperty({ description: "Codice identificativo univoco dell'utente.", example: 123 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Il codice utente deve essere un intero.' })
  @Min(1, { message: 'Il codice utente deve essere maggiore di zero.' })
  codiceUtente!: number;

  @ApiProperty({ description: "Email dell'utente.", example: 'mario.rossi@dev.it' })
  @IsOptional()
  @IsString({ message: "L'email deve essere una stringa." })
  @Length(3, 254, { message: "L'email deve essere compresa tra 3 e 254 caratteri." })
  email!: string;

  @ApiPropertyOptional({ description: "Flag per l'accettazione del GDPR.", example: true })
  @IsOptional()
  @IsBoolean({ message: 'Il flag GDPR deve essere booleano.' })
  flagGdpr?: boolean;

  @ApiPropertyOptional({
    description: 'Data di accettazione del GDPR.',
    format: 'date-time',
    example: '2024-03-18T12:34:56Z',
  })
  @IsOptional()
  @IsString({ message: 'La data GDPR deve essere una stringa.' })
  dataGdpr?: string;

  @ApiPropertyOptional({
    description: "Data di inserimento dell'utente nel sistema.",
    format: 'date-time',
    example: '2023-01-01T08:30:00Z',
  })
  @IsOptional()
  @IsString({ message: 'La data di inserimento deve essere una stringa.' })
  dataInserimento?: string;

  @ApiPropertyOptional({
    description: 'Data scadenza password.',
    format: 'date-time',
    example: '2025-06-01',
  })
  @IsOptional()
  @IsString({ message: 'La data scadenza password deve essere una stringa.' })
  dataScadenzaPassword?: string;

  @ApiPropertyOptional({
    description: "Ultima data di accesso dell'utente.",
    format: 'date-time',
    example: '2024-03-15T14:45:00Z',
  })
  @IsOptional()
  @IsString({ message: 'La data ultimo accesso deve essere una stringa.' })
  dataLastLogin?: string;

  @ApiPropertyOptional({
    description: "Stato della registrazione dell'utente.",
    enum: StatoRegistrazione,
    example: StatoRegistrazione.CONF,
  })
  @IsOptional()
  @IsEnum(StatoRegistrazione, { message: 'Lo stato di registrazione non e valido.' })
  statoRegistrazione?: StatoRegistrazione;

  @ApiPropertyOptional({
    description: "Chiave di registrazione dell'utente.",
    example: 'abc123xyz',
  })
  @IsOptional()
  @IsString({ message: 'La chiave registrazione deve essere una stringa.' })
  keyRegistrazione?: string;

  @ApiPropertyOptional({ description: "Cognome dell'utente.", example: 'Rossi' })
  @IsOptional()
  @IsString({ message: 'Il cognome deve essere una stringa.' })
  @Length(1, 255, { message: 'Il cognome deve essere compreso tra 1 e 255 caratteri.' })
  cognome?: string;

  @ApiPropertyOptional({ description: "Nome dell'utente.", example: 'Mario' })
  @IsOptional()
  @IsString({ message: 'Il nome deve essere una stringa.' })
  @Length(1, 255, { message: 'Il nome deve essere compreso tra 1 e 255 caratteri.' })
  nome?: string;

  @ApiPropertyOptional({
    description: 'Avatar (URL o base64).',
    type: String,
    example: 'https://example.com/avatar.jpg',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: "L'avatar deve essere una stringa." })
  avatar?: string | null;

  @ApiPropertyOptional({
    description: "Flag che indica se l'autenticazione a due fattori è attivata.",
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Il flag due fattori deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagDueFattori?: boolean;

  @ApiPropertyOptional({ description: 'Consente accesso con il solo codice email. Richiede flagDueFattori e viene gestito dagli amministratori.', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => obj[key])
  passwordlessLoginEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Codice lingua preferito.', example: 'it' })
  @IsOptional()
  @IsString({ message: 'Il codice lingua deve essere una stringa.' })
  @Length(1, 20, { message: 'Il codice lingua deve essere compreso tra 1 e 20 caratteri.' })
  codiceLingua?: string;

  @ApiPropertyOptional({
    description: 'Numero di cellulare.',
    type: String,
    example: '+393401234567',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Il cellulare deve essere una stringa.' })
  @Length(1, 50, { message: 'Il cellulare deve essere compreso tra 1 e 50 caratteri.' })
  cellulare?: string | null;

  @ApiPropertyOptional({ description: 'Flag superutente.', example: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag superutente deve essere booleano.' })
  flagSuper?: boolean;

  @ApiPropertyOptional({
    description: "Flag che indica se l'utente è configuratore",
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Il flag configuratore deve essere booleano.' })
  flagAdminConfigurator?: boolean;

  @ApiPropertyOptional({
    description: 'Abilita il login locale con password. Se false, l utente puo autenticarsi solo tramite identita SSO attive.',
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Il flag login password deve essere booleano.' })
  passwordLoginEnabled?: boolean;

  @ApiPropertyOptional({
    description: "Pagina di default dell'utente all'accesso.",
    example: '/dashboard',
  })
  @IsOptional()
  @IsString({ message: 'La pagina di default deve essere una stringa.' })
  paginaDefault?: string;

  @ApiPropertyOptional({
    description: "Numero MAC associato all'utente.",
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Il numero MAC deve essere un intero.' })
  @Min(0, { message: 'Il numero MAC non puo essere negativo.' })
  nummac?: number;

  @ApiPropertyOptional({
    description: 'Metadata JSON personalizzato.',
    example: '{"theme": "dark"}',
  })
  @IsOptional()
  @IsString({ message: 'I metadata JSON devono essere una stringa.' })
  jsonMetadata?: string;

  @ApiPropertyOptional({ description: 'Ragione sociale cliente.', example: 'ACME Corp SpA' })
  @IsOptional()
  @IsString({ message: 'La ragione sociale deve essere una stringa.' })
  ragSocCli?: string;

  @ApiPropertyOptional({ description: 'Codice causale movimento applicativa.', example: 'VEN' })
  @IsOptional()
  @IsString({ message: 'Il codice causale deve essere una stringa.' })
  caumov?: string;

  @ApiPropertyOptional({ description: 'Abilita l\'utente all\'uso dell\'assistente IA.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag IA deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  enableIa?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita MOP.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag MOP deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagMop?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita Piana.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Piana deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagPiana?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita Addetti.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Addetti deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagAddetti?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita Ospiti.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Ospiti deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagOspiti?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione Piana RFID.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Piana RFID deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagPianaRfid?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita Contabilita.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Conta deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagConta?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita Cubi.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Cubi deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagCubi?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione funzionalita Cicli passivi.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Cicli passivi deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagCicliPass?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione gestione dipendenti.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Dipendenti deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagDipendenti?: boolean;

  @ApiPropertyOptional({ description: 'Abilitazione gestione inventari.', default: false })
  @IsOptional()
  @IsBoolean({ message: 'Il flag Inventari deve essere booleano.' })
  @Transform(({ obj, key }) => obj[key])
  flagInventari?: boolean;

  @ApiPropertyOptional({ description: "Ruoli assegnati all'utente.", example: [1, 2] })
  @IsOptional()
  @IsArray({ message: 'I ruoli devono essere un array.' })
  @ArrayUnique({ message: 'I ruoli non possono contenere duplicati.' })
  @Type(() => Number)
  @IsInt({ each: true, message: 'Ogni ruolo deve essere un intero.' })
  roles?: number[];

  @ApiPropertyOptional({
    description: "Permessi assegnati all'utente.",
    type: [Permission],
    example: [{ codiceMenu: 'MNUOFFICINA', tipoAbilitazione: TipoAbilitazione.SCRITTURA }],
  })
  @IsOptional()
  @IsArray({ message: 'I permessi devono essere un array.' })
  @ValidateNested({ each: true })
  @Type(() => Permission)
  permissions?: Permission[];
}
