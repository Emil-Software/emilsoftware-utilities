import { ApiProperty } from "@nestjs/swagger";
import { TipoAbilitazione } from "./TipoAbilitazione";
import { IsString, IsNotEmpty, Length, IsEnum } from "class-validator";

export class Abilitazione {

  @ApiProperty({
    description: 'Codice univoco dell\'utente',
    example: 'USR12345'
  })
  @IsString()
  @IsNotEmpty({ message: "Il codice utente è obbligatorio." })
  @Length(5, 20, { message: "Il codice utente deve essere tra 5 e 20 caratteri." })
  codiceUtente!: number;

  @ApiProperty({
    description: 'Codice univoco del menu',
    example: 'MENU_001'
  })
  @IsString()
  @IsNotEmpty({ message: "Il codice menu è obbligatorio." })
  @Length(3, 20, { message: "Il codice menu deve essere tra 3 e 20 caratteri." })
  codiceMenu!: string;

  @ApiProperty({
    description: 'Tipo di abilitazione',
    enum: TipoAbilitazione,
    example: TipoAbilitazione.LETTURA
  })
  @IsEnum(TipoAbilitazione, { message: "Il tipo di abilitazione non è valido." })
  tipoAbilitazione!: TipoAbilitazione;
}