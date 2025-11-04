import { ApiProperty } from '@nestjs/swagger';

export class AssignRolesToUserRequest {
    @ApiProperty({
        description: "Lista dei codici dei ruoli da assegnare all'utente.",
        type: [String],
        example: [1, 2, 3]
    })
    roles: number[];
}
