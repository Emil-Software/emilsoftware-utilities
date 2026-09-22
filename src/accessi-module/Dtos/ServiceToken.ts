import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseResponse } from './BaseResponse';

/**
 * Richiesta di emissione di un token di servizio (macchina-a-macchina).
 * Il segreto viene generato dal server e restituito una sola volta.
 */
export class CreateServiceTokenRequest {
  @ApiProperty({ description: 'Descrizione del token, mostrata agli amministratori.', example: 'Integrazione IA - produzione' })
  @IsString({ message: 'La descrizione deve essere una stringa.' })
  @Length(1, 100, { message: 'La descrizione deve essere compresa tra 1 e 100 caratteri.' })
  label!: string;

  @ApiPropertyOptional({
    description: "Scope autorizzati dal token. Uno scope vuoto non autorizza nulla; usare valori come 'ia', 'chat', 'tools'.",
    type: [String],
    example: ['ia', 'chat'],
  })
  @IsOptional()
  @IsArray({ message: 'Gli scope devono essere un array.' })
  @ArrayUnique()
  @IsString({ each: true, message: 'Ogni scope deve essere una stringa.' })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Scadenza esplicita in formato ISO 8601. Alternativa a ttlDays.', example: '2027-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsString({ message: 'La scadenza deve essere una stringa ISO 8601.' })
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Durata in giorni, usata solo se expiresAt non e valorizzata.', example: 365 })
  @IsOptional()
  @IsInt({ message: 'ttlDays deve essere un intero.' })
  @Min(1, { message: 'ttlDays deve essere maggiore di zero.' })
  ttlDays?: number;
}

/** Metadati pubblici di un token di servizio; non contiene mai il segreto. */
export class ServiceTokenDto {
  @ApiProperty({ description: 'Identificativo pubblico del token.', example: 'st_3f1a2b3c4d5e6f708192a3b4c5d6e7f8' })
  tokenId!: string;

  @ApiProperty({ description: 'Descrizione del token.', example: 'Integrazione IA - produzione' })
  label!: string;

  @ApiProperty({ description: 'Scope autorizzati.', type: [String], example: ['ia', 'chat'] })
  scopes!: string[];

  @ApiPropertyOptional({ description: 'Data di creazione (ISO 8601).' })
  createdAt?: string;

  @ApiPropertyOptional({ description: 'Data di scadenza (ISO 8601); assente se il token non scade.' })
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Ultimo utilizzo registrato (ISO 8601).' })
  lastUsedAt?: string;

  @ApiPropertyOptional({ description: 'IP dell ultimo utilizzo registrato (audit).' })
  lastUsedIp?: string;

  @ApiProperty({ description: 'Indica se il token e revocato.' })
  revoked!: boolean;

  @ApiPropertyOptional({ description: 'Data di revoca (ISO 8601).' })
  revokedAt?: string;

  @ApiPropertyOptional({ description: 'Codice utente che ha revocato il token (audit).' })
  revokedBy?: number;
}

/** Risultato dell'emissione: include il segreto in chiaro, visibile solo in questa risposta. */
export class IssuedServiceTokenDto extends ServiceTokenDto {
  @ApiProperty({
    description: 'Token completo da usare come `Authorization: Bearer <token>`. Mostrato una sola volta.',
    example: 'st_3f1a2b3c4d5e6f708192a3b4c5d6e7f8.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  token!: string;
}

export class CreateServiceTokenResponse extends BaseResponse {
  @ApiProperty({ type: IssuedServiceTokenDto })
  @ValidateNested()
  @Type(() => IssuedServiceTokenDto)
  Result!: IssuedServiceTokenDto;
}

export class GetServiceTokensResponse extends BaseResponse {
  @ApiProperty({ type: [ServiceTokenDto] })
  @ValidateNested({ each: true })
  @Type(() => ServiceTokenDto)
  Result!: ServiceTokenDto[];
}
