import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { StatoRegistrazione } from "./StatoRegistrazione";
import { Permission } from "./Permission";
import { TipoAbilitazione } from "./TipoAbilitazione";
import { FiltriUtente } from "./FiltriUtente";

export class RegisterRequest extends OmitType(FiltriUtente, ['codUte'] as const) {
  @ApiProperty({
    description: "Email dell'utente.",
    example: "mario.rossi@dev.it",
  })
  email: string;

  @ApiPropertyOptional({
    description: "Cognome dell'utente.",
    example: "Rossi",
  })
  cognome?: string;

  @ApiPropertyOptional({ description: "Nome dell'utente.", example: "Mario" })
  nome?: string;

  @ApiPropertyOptional({
    description: "Numero di cellulare.",
    example: "+393401234567",
    nullable: true,
  })
  cellulare?: string | null;

  @ApiPropertyOptional({ description: "Flag superutente.", example: false })
  flagSuper?: boolean;

  
  @ApiPropertyOptional({
    description: "Flag che indica se l'utente è configuratore",
    example: false
  })
  flagAdminConfigurator?: boolean;

  @ApiPropertyOptional({
    description: "Ruoli assegnati all'utente.",
    example: ["admin", "editor"],
  })
  roles?: string[];

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
  permissions?: Permission[];


  // Campi aggiuntivi utente
  @ApiPropertyOptional({
    description: "Avatar dell'utente.",
    example: "user.svg",
  })
  avatar?: string;

  @ApiPropertyOptional({
    description: "Flag autenticazione a due fattori.",
    example: false,
  })
  flagDueFattori?: boolean;

  @ApiPropertyOptional({
    description: "Pagina di default dell'utente.",
    example: "/dashboard",
  })
  paginaDefault?: string;

  @ApiPropertyOptional({
    description: "Ragione sociale cliente.",
    example: "ALIVAL STOCK",
  })
  ragSocCli?: string;

  @ApiPropertyOptional({
    description: "HTML mail personalizzato",
    example: "<html></html>",
  })
  htmlMail?: string;
  
}
