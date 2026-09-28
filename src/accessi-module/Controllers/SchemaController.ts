import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Logger } from '../../Logger';
import { RestUtilities } from '../../Utilities';
import { ErrorResponse, GetSchemaResponse } from '../Dtos';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { ensureAdmin, getAuthenticatedAccessiUser } from '../security/accessControl';
import { SchemaExportService } from '../Services/SchemaExportService/SchemaExportService';

@ApiTags('Schema')
@ApiBearerAuth()
@Controller('accessi/schema')
@UseGuards(JwtSimpleGuard)
/** Esporta il DDL delle entita Accessi per replicare il database su altre installazioni. */
export class SchemaController {
  logger: Logger = new Logger(SchemaController.name);

  constructor(private readonly schemaExportService: SchemaExportService) {}

  @Get()
  @ApiOperation({
    operationId: 'getSchema',
    summary: 'Esporta lo schema DDL e le entita presenti',
    description: 'Riservato agli admin. Genera il DDL delle entita Accessi e segnala le tabelle presenti fuori schema.',
  })
  @ApiResponse({ status: 200, type: GetSchemaResponse })
  @ApiResponse({ status: 403, type: ErrorResponse })
  async getSchema(@Req() request: Request, @Res() res: Response) {
    try {
      ensureAdmin(getAuthenticatedAccessiUser(request));
      const ddl = this.schemaExportService.buildDdl();
      const entities = await this.schemaExportService.presentEntities();
      return RestUtilities.sendBaseResponse(res, { ...ddl, ...entities });
    } catch (error) {
      this.logger.error('Errore durante l esportazione dello schema', error);
      return RestUtilities.sendErrorMessage(res, error, SchemaController.name);
    }
  }
}
