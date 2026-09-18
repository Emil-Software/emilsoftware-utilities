import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsString, IsNotEmpty } from "class-validator";

export class UploadAllegatoResponseDto {
    @ApiProperty({
        description: 'ID assegnato al file caricato',
        example: 42,
    })
    @IsNumber()
    id!: number;

    @ApiProperty({
        description: 'Nome file salvato',
        example: 'preventivo.pdf',
    })
    @IsString()
    @IsNotEmpty({ message: "Il nome file è obbligatorio." })
    filename!: string;
}