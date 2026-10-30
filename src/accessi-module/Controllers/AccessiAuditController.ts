import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { AuditQueryRequest, ErrorResponse } from '../Dtos';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { ensureConsoleAccess, getAuthenticatedAccessiUser } from '../security/accessControl';
import { getAccessiAuditStore } from '../security/audit';
import type { AccessiAuditQuery, AccessiAuditQueryableSink } from '../security/audit';

/** Dimensione massima della pagina usata dall'export NDJSON. */
const EXPORT_PAGE_SIZE = 1_000;
/** Limite di sicurezza per un singolo export. */
const EXPORT_MAX_RECORDS = 100_000;

/**
 * Consultazione ed export dell'audit persistente.
 *
 * Richiede un utente super/admin Accessi. Se non e configurato uno store
 * interrogabile (`audit.store` o un sink con `query`), risponde 501 con un
 * codice stabile: l'host puo continuare a usare il solo log strutturato.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Controller('accessi/audit')
@UseGuards(JwtSimpleGuard)
export class AccessiAuditController {
  private store(): AccessiAuditQueryableSink {
    const store = getAccessiAuditStore();
    if (!store) {
      throw new HttpException(
        {
          code: 'ACCESSI_AUDIT_STORE_DISABLED',
          message: 'Audit persistente non configurato su questa istanza.',
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    return store;
  }

  private static toQuery(request: AuditQueryRequest): AccessiAuditQuery {
    return {
      ...(request.event?.trim() ? { event: request.event.trim() } : {}),
      ...(request.from ? { from: request.from } : {}),
      ...(request.to ? { to: request.to } : {}),
      ...(request.codiceUtente !== undefined ? { codiceUtente: request.codiceUtente } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.offset !== undefined ? { offset: request.offset } : {}),
      ...(request.order ? { order: request.order } : {}),
    };
  }

  private authorize(request: Request): void {
    const user = getAuthenticatedAccessiUser(request);
    ensureConsoleAccess(user, 'La consultazione audit richiede un superutente o un admin Accessi.');
  }

  @Get()
  @ApiOperation({
    operationId: 'queryAudit',
    summary: 'Elenca gli eventi di audit persistiti',
    description:
      'Richiede audit.store o un sink interrogabile. Supporta filtro per evento, intervallo, utente e paginazione.',
  })
  @ApiOkResponse({ description: 'Pagina di record di audit redatti.' })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'Token Accessi mancante o non valido.' })
  @ApiResponse({ status: 403, type: ErrorResponse, description: 'Utente non abilitato alla console.' })
  @ApiResponse({ status: 501, type: ErrorResponse, description: 'Audit persistente non configurato.' })
  async query(
    @Req() request: Request,
    @Query() query: AuditQueryRequest,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      this.authorize(request);
      const page = await this.store().query(AccessiAuditController.toQuery(query));
      return RestUtilities.sendBaseResponse(res, page);
    } catch (error) {
      return RestUtilities.sendErrorMessage(
        res,
        error,
        AccessiAuditController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('export')
  @ApiOperation({
    operationId: 'exportAudit',
    summary: 'Esporta gli eventi di audit in NDJSON',
    description:
      'Stessi filtri della query, senza paginazione. Il file contiene record gia redatti; limite di sicurezza 100000 record.',
  })
  @ApiResponse({ status: 200, description: 'NDJSON scaricabile.' })
  @ApiResponse({ status: 501, type: ErrorResponse, description: 'Audit persistente non configurato.' })
  async export(
    @Req() request: Request,
    @Query() query: AuditQueryRequest,
    @Res() res: Response,
  ): Promise<Response | void> {
    try {
      this.authorize(request);
      const store = this.store();
      const filter = AccessiAuditController.toQuery({ ...query, limit: undefined, offset: undefined });
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Content-Disposition', `attachment; filename="accessi-audit-${date}.ndjson"`);

      let offset = 0;
      let written = 0;
      for (;;) {
        const remaining = EXPORT_MAX_RECORDS - written;
        if (remaining <= 0) break;
        const page = await store.query({
          ...filter,
          limit: Math.min(EXPORT_PAGE_SIZE, remaining),
          offset,
        });
        for (const record of page.records) {
          res.write(`${JSON.stringify(record)}\n`);
          written += 1;
        }
        offset += page.records.length;
        if (page.records.length === 0 || offset >= page.total) break;
      }
      res.end();
      return res;
    } catch (error) {
      if (res.headersSent) {
        // L'export e gia iniziato: chiudere in modo esplicito invece di inviare JSON sopra l'NDJSON.
        res.end();
        return res;
      }
      return RestUtilities.sendErrorMessage(
        res,
        error,
        AccessiAuditController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
