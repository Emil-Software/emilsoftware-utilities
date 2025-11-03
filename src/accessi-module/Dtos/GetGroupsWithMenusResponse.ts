import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BaseResponse } from "./BaseResponse";
import { IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { MenuEntity } from "./GetMenusResponse";



export class GroupWithMenusEntity {
    @ApiProperty({
        description: "Codice univoco del gruppo.",
        type: String,
        example: "GRP01"
    })
    codiceGruppo: string;

    @ApiProperty({
        description: "Descrizione del gruppo.",
        type: String,
        example: "Gestione Accessi"
    })
    descrizioneGruppo: string;

    @ApiProperty({
        description: "Ordine del gruppo.",
        type: Number,
        example: 1
    })
    ordineGruppo: number;

    @ApiPropertyOptional({
        description: "Flag che indica se il gruppo e abilitato.",
        type: Boolean,
        example: true
    })
    enabled?: boolean;

    @ApiProperty({
        description: "Lista dei menù associati al gruppo.",
        type: [MenuEntity]
    })
    @ValidateNested({ each: true })
    @Type(() => MenuEntity)
    @IsArray()
    menus: MenuEntity[];
}

export class GetGroupsWithMenusResponse extends BaseResponse {
    @ApiProperty({ type: [GroupWithMenusEntity] })
    @ValidateNested({ each: true })
    @Type(() => GroupWithMenusEntity)
    Result: GroupWithMenusEntity[];
}
