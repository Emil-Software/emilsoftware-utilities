import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class DownloadAllegatoResponseDto {
    @ApiProperty({
        description: 'Contenuto base64 del file',
        example: 'JVBERi0xLjQKJcfsj6IKNSAwIG9iago8PAovVGl0bGUgKP7...',
    })
    @IsString()
    @IsNotEmpty({ message: "Il contenuto è obbligatorio." })
    contentBase64!: string;

    @ApiProperty({
        description: 'Nome originale del file',
        example: 'documento.pdf',
    })
    @IsString()
    @IsNotEmpty({ message: "Il nome file è obbligatorio." })
    filename!: string;

    @ApiProperty({
        description: 'Tipo MIME del file',
        example: 'application/pdf',
    })
    @IsString()
    @IsOptional()
    mimetype?: string;
}