import { ApiProperty } from "@nestjs/swagger";

export class TokenResult {
    @ApiProperty({
        description: "Tempo di scadenza del token in secondi",
        example: "3600"
    })
    expiresIn!: string;

    @ApiProperty({
        description: "Valore del token JWT o Basic",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    })
    value!: string;

    @ApiProperty({
        description: "Tipo di token di autenticazione",
        enum: ["Bearer", "Basic"],
        example: "Bearer"
    })
    type!: "Bearer" | "Basic";
}
