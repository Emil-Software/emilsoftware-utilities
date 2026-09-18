import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TwoFactorChallengeDto } from './TwoFactorDtos';
import { BaseResponse } from "./BaseResponse";
import { FiltriUtente } from "./FiltriUtente";
import { TokenResult } from "./TokenResult";
import { UserDto } from "./UserDto";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";
import { UserGrantsDto } from "./UserGrantsDto";

export class LoginResult {
  @ApiPropertyOptional({ enum: [true], description: 'Il primo passo email richiede ora la password. Nessun utente o token viene restituito.' })
  passwordRequired?: true;
  @ApiPropertyOptional({ type: TwoFactorChallengeDto, description: 'Presente solo quando serve il codice. Profilo, grant e token sono assenti fino alla verifica.' })
  @ValidateNested()
  @Type(() => TwoFactorChallengeDto)
  challenge?: TwoFactorChallengeDto;
  @ApiPropertyOptional({ description: 'Dati utente, presenti solo al completamento del login.', type: UserDto })
  @ValidateNested()
  @Type(() => UserDto)
  utente?: UserDto;

  @ApiPropertyOptional({ description: 'Filtri utente', type: [FiltriUtente], nullable: true })
  @ValidateNested({ each: true })
  @Type(() => FiltriUtente)
  /** Null is retained for historic demo responses; normal authenticated users receive an array. */
  filtri?: FiltriUtente[] | null;

  @ApiPropertyOptional({ description: 'Abilitazioni e ruoli utente', type: UserGrantsDto })
  @ValidateNested()
  @Type(() => UserGrantsDto)
  userGrants?: UserGrantsDto;

  @ApiPropertyOptional({ description: 'Extension Fields', type: Object})
  extensionFields?: Record<string, unknown[]>;

  @ApiPropertyOptional({ description: 'Token, assente durante la verifica del codice.', type: TokenResult })
  @ValidateNested()
  @Type(() => TokenResult)
  token?: TokenResult;
}

export class LoginResponse extends BaseResponse {
  @ApiProperty({ type: LoginResult })
  @ValidateNested()
  @Type(() => LoginResult)
  Result!: LoginResult;
}
