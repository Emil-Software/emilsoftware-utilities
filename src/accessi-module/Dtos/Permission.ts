import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsString, Length } from "class-validator";
import { TipoAbilitazione } from "./TipoAbilitazione";

export class Permission {
    @ApiProperty({
        description: "Codice identificativo del menu a cui assegnare l'abilitazione.",
        type: String,
        example: "MNU001"
    })
    @IsString({ message: "Il codice menu deve essere una stringa." })
    @Length(3, 50, { message: "Il codice menu deve essere compreso tra 3 e 50 caratteri." })
    codiceMenu: string;

    @ApiProperty({
        description: "Tipo di abilitazione assegnata all'utente per il menu specificato.",
        type: Number,
        example: 30
    })
    @IsEnum(TipoAbilitazione, { message: "Il tipo di abilitazione non e valido." })
    tipoAbilitazione: number;
}
