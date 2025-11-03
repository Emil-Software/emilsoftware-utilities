import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BaseResponse } from "./BaseResponse";
import { ValidateNested } from "class-validator";
import { Type } from "class-transformer";





export class MenuEntity {

    @ApiProperty({
        description: "Codice univoco del menù.",
        type: String,
        example: "MNU001"
    })
    codiceMenu: string;

    @ApiProperty({
        description: "Descrizione del menù.",
        type: String,
        example: "Gestione Utenti"
    })
    descrizioneMenu: string;

    @ApiProperty({
        description: "Codice del gruppo a cui appartiene il menù.",
        type: String,
        example: "GRP01",
        required: false
    })
    codiceGruppo?: string;

    @ApiProperty({
        description: "Descrizione del gruppo a cui appartiene il menù.",
        type: String,
        example: "Gestione Accessi",
        required: false
    })
    descrizioneGruppo?: string;

    @ApiProperty({
        description: "Percorso dell'icona associata al menù.",
        type: String,
        example: "fa-users",
        required: false
    })
    icona?: string;

    @ApiProperty({
        description: "Tipo di menù.",
        type: String,
        example: "admin",
        required: false
    })
    tipo?: string;

    @ApiProperty({
        description: "Percorso della pagina associata al menù.",
        type: String,
        example: "/accessi/gestione-utenti",
        required: false
    })
    pagina?: string;


    @ApiProperty({
        description: "Ordine del menu.",
        type: Number,
        example: 1
    })
    ordineMenu: number;


    @ApiProperty({
        description: "Ordine del gruppo.",
        type: Number,
        example: 1
    })
    ordineGruppo: number;

    @ApiPropertyOptional({
        description: "Flag che indica se il menu e abilitato.",
        type: Boolean,
        example: true
    })
    enabled?: boolean;

    @ApiPropertyOptional({
        description: "Tipo abilitazione opzionale",
        type: Number,
        example: 1
    })
    tipoAbilitazione?: number;
}

export class GetMenusResponse extends BaseResponse {
    @ApiProperty({ type: [MenuEntity] })
    @ValidateNested({ each: true })
    @Type(() => MenuEntity)
    Result: MenuEntity[];
}
