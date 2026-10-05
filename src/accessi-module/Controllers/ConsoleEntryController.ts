import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import type { AccessiOptions } from '../AccessiModule';
import { ConsoleEntryExchangeRequest, ConsoleEntrySessionResponse, ConsoleEntryTicketResponse } from '../Dtos/ConsoleEntryDtos';
import { ErrorResponse } from '../Dtos/BaseResponse';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { ensureConsoleAccess, getAuthenticatedAccessiUser } from '../security/accessControl';
import { extractAccessiBearerToken } from '../security/authenticatedToken';
import { consumeConsoleEntryTicket, issueConsoleEntryTicket } from '../security/consoleEntry';
import {
  checkPublicAuthRateLimit,
  sendPublicAuthRateLimitExceeded,
} from '../security/publicAuthRateLimit';

/**
 * Auto-ingresso alla console amministrativa da un frontend gia autenticato.
 * Il frontend scambia la propria sessione Accessi con un ticket monouso, poi apre
 * `/api/accessi/console#entry=<ticket>`: il JWT non passa mai nell'URL.
 */
@ApiTags('Console')
@ApiBearerAuth()
@Controller('accessi/console')
export class ConsoleEntryController {
  constructor(@Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions) {}

  @ApiOperation({
    summary: 'Emetti un ticket di ingresso alla console',
    operationId: 'createConsoleEntryTicket',
    description: 'Riservato agli utenti abilitati alla console (FLGSUPER/FLGADMIN). Restituisce un ticket monouso legato all utente, valido pochi secondi.',
  })
  @ApiOkResponse({ type: ConsoleEntryTicketResponse })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'Token Accessi mancante o non valido.' })
  @ApiResponse({ status: 403, type: ErrorResponse, description: 'Utente non abilitato alla console.' })
  @UseGuards(JwtSimpleGuard)
  @Post('entry')
  async createEntryTicket(@Req() request: Request, @Res() res: Response) {
    try {
      const user = getAuthenticatedAccessiUser(request);
      ensureConsoleAccess(user);

      const tokenValue = extractAccessiBearerToken(request.headers['authorization']);
      if (!tokenValue) {
        throw new UnauthorizedException({ code: 'ACCESSI_CONSOLE_ENTRY_TOKEN_MISSING', message: 'Token Accessi mancante.' });
      }

      const issued = issueConsoleEntryTicket({ token: tokenValue, codiceUtente: user.codiceUtente });
      return RestUtilities.sendBaseResponse(res, issued);
    } catch (error) {
      return RestUtilities.sendErrorMessage(
        res,
        error,
        ConsoleEntryController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @ApiOperation({
    summary: 'Scambia il ticket con la sessione Accessi',
    operationId: 'exchangeConsoleEntryTicket',
    description: 'Endpoint pubblico (il ticket e l unica credenziale) protetto da rate limit; il ticket e monouso e scade in pochi secondi.',
  })
  @ApiBody({ type: ConsoleEntryExchangeRequest })
  @ApiOkResponse({ type: ConsoleEntrySessionResponse })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'Ticket non valido o scaduto.' })
  @ApiResponse({ status: 429, type: ErrorResponse, description: 'Troppi tentativi.' })
  @Post('entry/exchange')
  async exchangeEntryTicket(
    @Req() request: Request,
    @Body() body: ConsoleEntryExchangeRequest,
    @Res() res: Response,
  ) {
    try {
      const decision = checkPublicAuthRateLimit(this.options, 'consoleEntry', request, [body?.ticket ?? '']);
      if (!decision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, decision.retryAfterSeconds);
      }

      const entry = consumeConsoleEntryTicket(body?.ticket);
      if (!entry) {
        throw new UnauthorizedException({
          code: 'ACCESSI_CONSOLE_ENTRY_INVALID',
          message: 'Ticket di ingresso console non valido o scaduto. Riapri la console dal frontend.',
        });
      }

      return RestUtilities.sendBaseResponse(res, { token: { value: entry.token, type: 'Bearer' } });
    } catch (error) {
      return RestUtilities.sendErrorMessage(
        res,
        error,
        ConsoleEntryController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
