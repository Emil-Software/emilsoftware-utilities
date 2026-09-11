import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { RegisterRequest } from './RegisterRequest';
import { BaseResponse } from './BaseResponse';

/** Administrative request to associate an already verified external identity. */
export class CreateFederatedIdentityRequest {
  @ApiProperty({ example: 'azure-ad-acme-produzione', description: 'Chiave stabile di un provider già censito nel catalogo Accessi. Deve corrispondere alla configurazione del backend e distinguere tenant e ambiente quando necessario.' })
  @IsString()
  @Length(1, 64)
  provider!: string;

  @ApiProperty({ example: 'a1b2c3d4-...', description: 'ID stabile della persona restituito dal provider dopo validazione lato backend, ad esempio oid, sub o NameID persistente. Non usare l email o lo username.' })
  @IsString()
  @Length(1, 512)
  subject!: string;

  @ApiPropertyOptional({ example: 'Association approved by IT.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** Per-user login policy. Absent rows preserve the historic password-enabled behaviour. */
export class SetPasswordLoginPolicyRequest {
  @ApiProperty({ example: false, description: 'Se false, il login password restituisce PASSWORD_LOGIN_DISABLED; restano validi solo collegamenti SSO attivi.' })
  @IsBoolean()
  passwordLoginEnabled!: boolean;
}

/** Aggiornamento amministrativo di un collegamento SSO gia esistente. */
export class UpdateFederatedIdentityRequest {
  @ApiPropertyOptional({ example: true, description: 'Abilita o disabilita il collegamento senza cancellare lo storico.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'Collegamento verificato dal reparto IT.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** Master-only provisioning payload for an SSO user. No password is created by this operation. */
export class CreateFederatedUserRequest extends CreateFederatedIdentityRequest {
  @ApiProperty({ type: RegisterRequest, description: 'Accessi profile, grants and roles assigned by the master user.' })
  @ValidateNested()
  @Type(() => RegisterRequest)
  user!: RegisterRequest;

  @ApiPropertyOptional({ default: false, description: 'Enables local password login for the newly created user. Defaults to false (SSO-only).' })
  @IsOptional()
  @IsBoolean()
  passwordLoginEnabled?: boolean;
}

/** Read model for a persisted federated identity. It never contains an external token or provider claims. */
export class FederatedIdentityResponseDto {
  @ApiProperty({ example: '4f2b...', description: 'Chiave tecnica SHA-256 del collegamento. Usarla solo per operazioni amministrative, mai per autenticare.' })
  identityKey!: string;

  @ApiProperty({ example: 123 })
  codiceUtente!: number;

  @ApiProperty({ example: 'azure-ad-acme-produzione', description: 'Chiave del provider censito nel catalogo Accessi.' })
  provider!: string;

  @ApiProperty({ example: 'a1b2c3d4-...', description: 'ID stabile dell account nel provider, usato insieme a provider per riconoscere la persona.' })
  subject!: string;

  @ApiProperty({ example: true, description: 'False means soft-disabled: the row remains auditable but cannot authenticate.' })
  active!: boolean;

  @ApiProperty({ example: false, description: 'Effective local-password policy for the associated Accessi user.' })
  passwordLoginEnabled!: boolean;

  @ApiPropertyOptional({ example: '2026-09-01T09:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-09-01T09:30:00.000Z' })
  lastLoginAt?: string;

  @ApiPropertyOptional({ example: '2026-09-01T10:00:00.000Z' })
  disabledAt?: string;

  @ApiPropertyOptional()
  note?: string;
}

/** Standard Accessi wrapper for one federated identity. */
export class FederatedIdentityResponse extends BaseResponse {
  @ApiProperty({ type: FederatedIdentityResponseDto })
  @ValidateNested()
  @Type(() => FederatedIdentityResponseDto)
  Result!: FederatedIdentityResponseDto;
}

/** Standard Accessi wrapper for a user's federated identities. */
export class FederatedIdentityListResponse extends BaseResponse {
  @ApiProperty({ type: [FederatedIdentityResponseDto] })
  @ValidateNested({ each: true })
  @Type(() => FederatedIdentityResponseDto)
  Result!: FederatedIdentityResponseDto[];
}

/** Catalog entry for a backend-managed SSO provider. No secret or token configuration is stored here. */
export class CreateFederatedProviderRequest {
  @ApiProperty({ example: 'azure-ad-acme-produzione', description: 'Chiave stabile ASCII configurata anche nel backend. Deve distinguere tenant e ambiente quando necessario.' })
  @IsString()
  @Length(1, 64)
  provider!: string;

  @ApiProperty({ example: 'Microsoft Entra ID Acme - Produzione', description: 'Descrizione amministrativa del provider mostrata nella console.' })
  @IsString()
  @Length(1, 160)
  description!: string;

  @ApiPropertyOptional({ example: 'Validazione OIDC gestita dal backend impianti.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** Administrative changes for a registered SSO provider. The stable provider key cannot be changed. */
export class UpdateFederatedProviderRequest {
  @ApiPropertyOptional({ example: 'Microsoft Entra ID Acme - Produzione' })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  description?: string;

  @ApiPropertyOptional({ example: true, description: 'Con false il provider e tutte le sue identita non possono autenticare nuove sessioni SSO.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'Manutenzione programmata.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** Read model for the provider catalog. It intentionally has no client secret, issuer or token fields. */
export class FederatedProviderResponseDto {
  @ApiProperty({ example: 'azure-ad-acme-produzione' })
  provider!: string;

  @ApiProperty({ example: 'Microsoft Entra ID Acme - Produzione' })
  description!: string;

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiPropertyOptional({ example: '2026-09-04T09:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: 'Validazione OIDC gestita dal backend.' })
  note?: string;
}

export class FederatedProviderResponse extends BaseResponse {
  @ApiProperty({ type: FederatedProviderResponseDto })
  @ValidateNested()
  @Type(() => FederatedProviderResponseDto)
  Result!: FederatedProviderResponseDto;
}

export class FederatedProviderListResponse extends BaseResponse {
  @ApiProperty({ type: [FederatedProviderResponseDto] })
  @ValidateNested({ each: true })
  @Type(() => FederatedProviderResponseDto)
  Result!: FederatedProviderResponseDto[];
}
