import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt } from 'class-validator';

export class AssignRolesToUserRequest {
    @ApiProperty({
        description: "Lista dei codici dei ruoli da assegnare all'utente.",
        type: [String],
        example: [1, 2, 3]
    })
    @IsArray({ message: 'I ruoli devono essere un array.' })
    @Type(() => Number)
    @IsInt({ each: true, message: 'Ogni ruolo deve essere un intero.' })
    roles: number[];
}
