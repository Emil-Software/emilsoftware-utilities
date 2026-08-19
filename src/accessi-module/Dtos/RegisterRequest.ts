import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import { Permission } from "./Permission";
import { TipoAbilitazione } from "./TipoAbilitazione";
import { FiltriUtente } from "./FiltriUtente";

export class RegisterRequest extends OmitType(FiltriUtente, ['codUte'] as const) {
  @ApiProperty({
    description: "Email dell'utente.",
    example: "mario.rossi@dev.it",
  })
  @IsString({ message: "L'email deve essere una stringa." })
  @Length(3, 254, { message: "L'email deve essere compresa tra 3 e 254 caratteri." })
  email: string;

  @ApiPropertyOptional({
    description: "Cognome dell'utente.",
    example: "Rossi",
  })
  @IsOptional()
  @IsString({ message: "Il cognome deve essere una stringa." })
  @Length(1, 255, { message: "Il cognome deve essere compreso tra 1 e 255 caratteri." })
  cognome?: string;

  @ApiPropertyOptional({ description: "Nome dell'utente.", example: "Mario" })
  @IsOptional()
  @IsString({ message: "Il nome deve essere una stringa." })
  @Length(1, 255, { message: "Il nome deve essere compreso tra 1 e 255 caratteri." })
  nome?: string;

  @ApiPropertyOptional({
    description: "Numero di cellulare.",
    example: "+393401234567",
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: "Il cellulare deve essere una stringa." })
  @Length(1, 50, { message: "Il cellulare deve essere compreso tra 1 e 50 caratteri." })
  cellulare?: string | null;

  @ApiPropertyOptional({ description: "Flag superutente.", example: false })
  @IsOptional()
  @IsBoolean({ message: "Il flag superutente deve essere booleano." })
  flagSuper?: boolean;

  @ApiPropertyOptional({
    description: "Flag che indica se l'utente è configuratore",
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: "Il flag configuratore deve essere booleano." })
  flagAdminConfigurator?: boolean;

  @ApiPropertyOptional({
    description: "Ruoli assegnati all'utente.",
    example: [1, 2],
  })
  @IsOptional()
  @IsArray({ message: "I ruoli devono essere un array." })
  @ArrayUnique({ message: "I ruoli non possono contenere duplicati." })
  @Type(() => Number)
  @IsInt({ each: true, message: "Ogni ruolo deve essere un intero." })
  roles?: number[];

  @ApiPropertyOptional({
    description: "Permessi assegnati all'utente.",
    type: [Permission],
    example: [
      {
        codiceMenu: "MNUOFFICINA",
        tipoAbilitazione: TipoAbilitazione.SCRITTURA,
      },
    ],
  })
  @IsOptional()
  @IsArray({ message: "I permessi devono essere un array." })
  @ValidateNested({ each: true })
  @Type(() => Permission)
  permissions?: Permission[];

  @ApiPropertyOptional({
    description: "Avatar dell'utente.",
    example: "user.svg",
  })
  @IsOptional()
  @IsString({ message: "L'avatar deve essere una stringa." })
  avatar?: string;

  @ApiPropertyOptional({
    description: "Flag autenticazione a due fattori.",
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: "Il flag due fattori deve essere booleano." })
  flagDueFattori?: boolean;

  @ApiPropertyOptional({
    description: "Pagina di default dell'utente.",
    example: "/dashboard",
  })
  @IsOptional()
  @IsString({ message: "La pagina di default deve essere una stringa." })
  paginaDefault?: string;

  @ApiPropertyOptional({
    description: "Ragione sociale cliente.",
    example: "ALIVAL STOCK",
  })
  @IsOptional()
  @IsString({ message: "La ragione sociale deve essere una stringa." })
  ragSocCli?: string;

  @ApiPropertyOptional({
    description: "HTML mail personalizzato",
    example: "<html></html>",
  })
  @IsOptional()
  @IsString({ message: "L'HTML della mail deve essere una stringa." })
  htmlMail?: string;
}
