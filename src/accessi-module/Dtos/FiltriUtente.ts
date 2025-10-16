import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsPort, IsString, Min, ValidateNested } from 'class-validator';
import { BaseResponse } from './BaseResponse';
import { TipoFiltro } from './TipoFiltro';

export class FiltriUtente {

  @ApiProperty({
    description: 'Codice dell\'utente',
    example: 1
  })
  codUte: number

  @ApiPropertyOptional({
    description: 'Progressivo identificativo del filtro',
    example: 1,
  })
  @IsInt({ message: 'Il progressivo deve essere un numero intero.' })
  @Min(1, { message: 'Il progressivo deve essere maggiore di 0.' })
  progressivo?: number;

  @ApiPropertyOptional({
    description: 'Numero del reparto associato',
    example: 1002,
  })
  @IsInt({ message: 'Il numero del reparto deve essere un numero intero.' })
  @IsOptional()
  numRep?: number;

  @ApiPropertyOptional({
    description: 'Idx personale',
    example: 15,
  })
  @IsInt({ message: "L'indice personale deve essere un numero intero." })
  @IsOptional()
  idxPers?: number;

  @ApiPropertyOptional({
    description: 'Codice Cliente padre (codcli di esgest)',
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  codCliSuper?: number;

  @ApiPropertyOptional({
    description: 'Codice dell\'agente associato',
    example: 1
  })
  @IsNumber()
  @IsOptional()
  codAge?: number;

  @ApiPropertyOptional({
    description: 'Codice del cliente collegato',
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  codCliCol?: number;

  @ApiPropertyOptional({
    description: 'Lista di codici clienti separati da virgola',
    example: '123,456,789',
  })
  @IsString()
  @IsOptional()
  codClienti?: string;

  @ApiPropertyOptional({
    description: 'Tipo di filtro applicato',
    example: 99,
  })
  @IsNumber()
  @IsOptional()
  tipFil?: number;

  @ApiPropertyOptional({
    description: 'idx della postazione nella tabella ANTENNE_POS di PROLAV',
    example: 12,
  })
  idxPos?: number;

  @ApiPropertyOptional({
    description: 'Codice dipendente di esgest',
    example: 12
  })
  @IsNumber()
  @IsOptional()
  codDip?: number

  @ApiPropertyOptional({
    description: 'Codice del vettore',
    example: 12
  })
  codVet?: number
}

export class GetFiltriUtenteResponse extends BaseResponse {
      @ApiProperty({ type: FiltriUtente })
      @ValidateNested({ each: true })
      @Type(() => FiltriUtente)
    Result : FiltriUtente[]
}

export class GetFiltriUtenteRequest {
    @ApiPropertyOptional({
        description: 'Codice utente',
    })
    @IsNumber()
    @IsOptional()
    codUte?: number
}

export const FILTRI_UTENTE_DB_MAPPING = {
  progressivo:  { dbField: 'PROG',        numeric: true  },
  numRep:       { dbField: 'NUMREP',      numeric: true  },
  idxPers:      { dbField: 'IDXPERS',     numeric: true  },
  codCliSuper:  { dbField: 'CODCLISUPER', numeric: true  },
  codAge:       { dbField: 'CODAGE',      numeric: true  },
  codCliCol:    { dbField: 'CODCLICOL',   numeric: true  },
  codClienti:   { dbField: 'CODCLIENTI',  numeric: false },
  tipFil:       { dbField: 'TIPFIL',      numeric: true  },
  idxPos:       { dbField: 'IDXPOS',      numeric: true  },
  codDip:       { dbField: 'CODDIP',      numeric: true  },
  codVet:       { dbField: 'CODVET',      numeric: true  },
} as const;
