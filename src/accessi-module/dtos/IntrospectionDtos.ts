import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { BaseResponse } from "./BaseResponse";
import { UserDto } from "./UserDto";
import { UserGrantsDto } from "./UserGrantsDto";

/** Body service-to-service per validare un access token Accessi. */
export class IntrospectAccessiTokenRequest {
  @ApiProperty({ description: "Access token Accessi da verificare." })
  @IsString()
  token!: string;
}

/** Esito dell'introspection: `active` false per token invalido, scaduto o utente non piu abilitato. */
export class AccessiIntrospectionResultDto {
  @ApiProperty({ description: "True se il token e valido e l'utente e ancora abilitato." })
  active!: boolean;

  @ApiPropertyOptional({ description: "Profilo utente corrente.", type: UserDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserDto)
  user?: UserDto;

  @ApiPropertyOptional({ description: "Grant correnti dell'utente.", type: UserGrantsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserGrantsDto)
  grants?: UserGrantsDto;
}

export class IntrospectAccessiTokenResponse extends BaseResponse {
  @ApiProperty({ type: AccessiIntrospectionResultDto })
  @ValidateNested()
  @Type(() => AccessiIntrospectionResultDto)
  Result!: AccessiIntrospectionResultDto;
}
