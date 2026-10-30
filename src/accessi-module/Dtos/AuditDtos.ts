import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/** Filtri degli endpoint audit per amministratori. */
export class AuditQueryRequest {
  @ApiPropertyOptional({ description: 'Nome esatto dell evento, es. login_succeeded.' })
  @IsOptional()
  @IsString()
  event?: string;

  @ApiPropertyOptional({ description: 'Inizio intervallo (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Fine intervallo (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Filtra per codice utente Accessi.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  codiceUtente?: number;

  @ApiPropertyOptional({ description: 'Record per pagina. Default 100, massimo 1000.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Offset della pagina. Default 0.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Ordinamento per timestamp. Default desc.' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
