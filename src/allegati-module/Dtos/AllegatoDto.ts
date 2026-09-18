import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class AllegatoDto {

    @ApiProperty({
        description: 'ID univoco dell\'allegato',
        example: 1,
    })
    @IsNumber()
    id!: number;

    @ApiProperty({
        description: 'Nome originale del file caricato',
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
    @IsNotEmpty({ message: "Il tipo MIME è obbligatorio." })
    mimetype!: string;

    @ApiProperty({
        description: 'Data di caricamento del file in formato ISO',
        example: '2025-04-27T12:00:00Z',
    })
    @IsString()
    @IsNotEmpty({ message: "La data di upload è obbligatoria." })
    uploadDate!: string;

    @ApiProperty({
        description: 'Codice incrementale',
        example: '1',
    })
    @IsString()
    @IsOptional()
    codice?: string;

    @ApiProperty({
        description: 'Tipo del codice fornito',
        example: 'CF',
    })
    @IsString()
    @IsOptional()
    tipoCodice?: string;

    @ApiProperty({
        description: 'Numero o valore usato per ordinare o identificare la sequenza degli allegati',
        example: '1',
    })
    @IsString()
    @IsOptional()
    ordine?: string;

    @ApiProperty({
        description: 'Descrizione testuale dell\'allegato',
        example: 'Documento di identità fronte',
    })
    @IsString()
    @IsOptional()
    descrizioneAllegato?: string;

    @ApiProperty({
        description: 'Data di inizio validità del documento',
        example: '2024-01-01',
    })
    @IsString()
    @IsOptional()
    dataInizioValidita?: string;

    @ApiProperty({
        description: 'Data di fine validità del documento',
        example: '2025-01-01',
    })
    @IsString()
    @IsOptional()
    dataFineValidita?: string;

    @ApiProperty({
        description: 'ID del tipo di allegato',
        example: 3,
    })
    @IsNumber()
    @IsOptional()
    idTipoAllegato?: number;

    @ApiProperty({
        description: 'Riferimento esterno o identificativo del documento',
        example: 'PRAT-2024-0001',
    })
    @IsString()
    @IsOptional()
    riferimentoDocumento?: string;
}