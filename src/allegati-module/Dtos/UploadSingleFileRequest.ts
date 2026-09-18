import { ApiProperty } from '@nestjs/swagger';

export class UploadSingleFileRequest {
  @ApiProperty({
    description: 'Codice identificativo del soggetto o dell’entità (es. codice fiscale, matricola, ecc.)',
    example: 'RSSMRA85M01H501Z',
  })
  codice!: string;

  @ApiProperty({
    description: 'Tipo del codice fornito (es. CF, PI, MATRICOLA)',
    example: 'CF',
  })
  tipoCodice!: string;

  @ApiProperty({
    description: 'Numero o valore usato per ordinare o identificare la sequenza degli allegati',
    example: '1',
  })
  ordine!: string;

  @ApiProperty({
    description: 'Descrizione testuale dell’allegato',
    example: 'Documento di identità fronte',
  })
  descrizioneAllegato!: string;

  @ApiProperty({
    description: 'Nome del file originale caricato',
    example: 'documento_identita.pdf',
  })
  nomeFile!: string;

  @ApiProperty({
    description: 'Data di inizio validità del documento (formato ISO)',
    example: '2024-01-01',
  })
  dataInizioValidita!: string;

  @ApiProperty({
    description: 'Data di fine validità del documento (formato ISO)',
    example: '2025-01-01',
  })
  dataFineValidita!: string;

  @ApiProperty({
    description: 'ID del tipo di allegato secondo tabella master (FK)',
    example: 3,
  })
  idTipoAllegato!: number;

  @ApiProperty({
    description: 'Riferimento esterno o identificativo del documento (es. numero pratica)',
    example: 'PRAT-2024-0001',
  })
  riferimentoDocumento!: string;
}
