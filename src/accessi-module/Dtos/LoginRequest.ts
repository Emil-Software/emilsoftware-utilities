import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class LoginRequest {
    
    @ApiProperty({
        description: 'Email dell\'utente',
        example: 'mario.rossi'
    })
    @IsString({ message: "L'email deve essere una stringa." })
    @Length(3, 50, { message: "L'email deve essere tra 3 e 50 caratteri." })
    email: string;

    @ApiPropertyOptional({
        description: 'Password: omettere soltanto per utenti con accesso tramite solo codice abilitato.',
        example: 'Str0ngP@ssw0rd!'
    })
    @IsString({ message: "La password deve essere una stringa." })
    @IsOptional()
    @Length(8, 100, { message: "La password deve essere tra 8 e 100 caratteri." })
    password?: string;
}
