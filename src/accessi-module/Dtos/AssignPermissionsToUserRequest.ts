import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { Permission } from './Permission';

export class AssignPermissionsToUserRequest {
    @ApiProperty({
        description: "Lista delle abilitazioni da assegnare all'utente.",
        type: [Permission],
        example: [
            { codiceMenu: "MNU001", tipoAbilitazione: 30 },
            { codiceMenu: "MNU002", tipoAbilitazione: 10 }
        ]
    })
    @IsArray({ message: 'Le abilitazioni devono essere un array.' })
    @ValidateNested({ each: true })
    @Type(() => Permission)
    permissions: Permission[];
}
