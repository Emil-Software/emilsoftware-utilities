import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { StatoRegistrazione } from './StatoRegistrazione';
import { Permission } from './Permission';
import { TipoAbilitazione } from './TipoAbilitazione';
import { FiltriUtente } from './FiltriUtente';

export class UserDto extends OmitType(FiltriUtente, ['codUte'] as const)  {
  @ApiProperty({ description: "Codice identificativo univoco dell'utente.", example: 'USR123' })
  codiceUtente: number;

  @ApiProperty({ description: "Email dell'utente.", example: 'mario.rossi@dev.it' })
  email: string;

  @ApiPropertyOptional({ description: "Flag per l'accettazione del GDPR.", example: true })
  flagGdpr?: boolean;

  @ApiPropertyOptional({
    description: 'Data di accettazione del GDPR.',
    format: 'date-time',
    example: '2024-03-18T12:34:56Z',
  })
  dataGdpr?: string;

  @ApiPropertyOptional({
    description: "Data di inserimento dell'utente nel sistema.",
    format: 'date-time',
    example: '2023-01-01T08:30:00Z',
  })
  dataInserimento?: string;

  @ApiPropertyOptional({
    description: 'Data scadenza password.',
    format: 'date-time',
    example: '2025-06-01',
  })
  dataScadenzaPassword?: string;

  @ApiPropertyOptional({
    description: "Ultima data di accesso dell'utente.",
    format: 'date-time',
    example: '2024-03-15T14:45:00Z',
  })
  dataLastLogin?: string;

  @ApiPropertyOptional({
    description: "Stato della registrazione dell'utente.",
    enum: StatoRegistrazione,
    example: StatoRegistrazione.CONF,
  })
  statoRegistrazione?: StatoRegistrazione;

  @ApiPropertyOptional({
    description: "Chiave di registrazione dell'utente.",
    example: 'abc123xyz',
  })
  keyRegistrazione?: string;

  @ApiPropertyOptional({ description: "Cognome dell'utente.", example: 'Rossi' })
  cognome?: string;

  @ApiPropertyOptional({ description: "Nome dell'utente.", example: 'Mario' })
  nome?: string;

  @ApiPropertyOptional({
    description: 'Avatar (URL o base64).',
    example: 'https://example.com/avatar.jpg',
    nullable: true,
  })
  avatar?: string | null;

  @ApiPropertyOptional({
    description: "Flag che indica se l'autenticazione a due fattori è attivata.",
    example: true,
  })
  flagDueFattori?: boolean;

  @ApiPropertyOptional({ description: 'Codice lingua preferito.', example: 'it' })
  codiceLingua?: string;

  @ApiPropertyOptional({
    description: 'Numero di cellulare.',
    example: '+393401234567',
    nullable: true,
  })
  cellulare?: string | null;

  @ApiPropertyOptional({ description: 'Flag superutente.', example: false })
  flagSuper?: boolean;

  @ApiPropertyOptional({
    description: "Flag che indica se l'utente è configuratore",
    example: false
  })
  flagAdminConfigurator?: boolean;

  @ApiPropertyOptional({
    description: "Pagina di default dell'utente all'accesso.",
    example: '/dashboard',
  })
  paginaDefault?: string;

  @ApiPropertyOptional({
    description: 'Metadata JSON personalizzato.',
    example: '{"theme": "dark"}',
  })
  jsonMetadata?: string;

  @ApiPropertyOptional({ description: 'Ragione sociale cliente.', example: 'ACME Corp SpA' })
  ragSocCli?: string;

  @ApiPropertyOptional({ description: "Ruoli assegnati all'utente.", example: ['admin', 'editor'] })
  roles?: string[];

  @ApiPropertyOptional({
    description: "Permessi assegnati all'utente.",
    type: [Permission],
    example: [{ codiceMenu: 'MNUOFFICINA', tipoAbilitazione: TipoAbilitazione.SCRITTURA }],
  })
  permissions?: Permission[];

}
