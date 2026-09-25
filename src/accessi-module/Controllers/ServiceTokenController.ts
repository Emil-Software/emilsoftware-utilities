import { Body, Controller, Delete, Get, HttpException, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import type { AccessiOptions } from '../AccessiModule';
import {
  CreateServiceTokenRequest,
  CreateServiceTokenResponse,
  ErrorResponse,
  GetServiceTokensResponse,
} from '../Dtos';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { getAuthenticatedAccessiUser, ensureAdmin } from '../security/accessControl';
import { ServiceTokenService } from '../Services/ServiceTokenService/ServiceTokenService';

/**
 * Gestione amministrativa dei token di servizio (macchina-a-macchina).
 *
 * Il segreto e mostrato una sola volta alla creazione/rotazione; le operazioni richiedono un
 * superutente Accessi. Gli endpoint di utilizzo dei token non sono qui: i consumer autenticano
 * con `Authorization: Bearer <token>` tramite `ServiceTokenGuard`.
 */
@ApiBearerAuth()
@ApiTags('ServiceToken')
@Controller('accessi/service-token')
@UseGuards(JwtSimpleGuard)
export class ServiceTokenController {
  constructor(
    private readonly serviceTokenService: ServiceTokenService,
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
  ) {}

  private assertEnabled(): void {
    if (this.options.serviceTokens?.enabled === false) {
      throw new HttpException('I token di servizio sono disabilitati in questa istanza.', 404);
    }
  }

  private requireSuperUser(req: Request) {
    this.assertEnabled();
    const user = getAuthenticatedAccessiUser(req);
      ensureAdmin(user, 'Solo un admin puo gestire i token di servizio.');
    return user;
  }

  private sendError(res: Response, error: unknown): Response {
    // Lo status viene derivato centralmente da RestUtilities (HttpException o 500).
    return RestUtilities.sendErrorMessage(res, error, ServiceTokenController.name);
  }

  @Post()
  @ApiOperation({ summary: 'Emetti un nuovo token di servizio', operationId: 'createServiceToken' })
  @ApiBody({ type: CreateServiceTokenRequest })
  @ApiResponse({ status: 201, description: 'Token creato; il segreto e mostrato solo in questa risposta.', type: CreateServiceTokenResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 401, description: 'Token Accessi mancante o non valido', type: ErrorResponse })
  @ApiResponse({ status: 403, description: 'Richiede un superutente', type: ErrorResponse })
  async create(
    @Body() body: CreateServiceTokenRequest,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const user = this.requireSuperUser(req);
      const issued = await this.serviceTokenService.issue(body, user.codiceUtente);
      return RestUtilities.sendBaseResponse(res, issued, 201);
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Elenca i token di servizio (senza segreti)', operationId: 'getServiceTokens' })
  @ApiQuery({ name: 'includeRevoked', required: false, description: 'Includi anche i token revocati.', type: Boolean })
  @ApiResponse({ status: 200, description: 'Elenco dei token.', type: GetServiceTokensResponse })
  @ApiResponse({ status: 401, description: 'Token Accessi mancante o non valido', type: ErrorResponse })
  @ApiResponse({ status: 403, description: 'Richiede un superutente', type: ErrorResponse })
  async list(
    @Query('includeRevoked') includeRevoked: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      this.requireSuperUser(req);
      const tokens = await this.serviceTokenService.list(includeRevoked === 'true');
      return RestUtilities.sendBaseResponse(res, tokens);
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @Delete(':tokenId')
  @ApiOperation({ summary: 'Revoca un token di servizio', operationId: 'revokeServiceToken' })
  @ApiParam({ name: 'tokenId', description: 'Identificativo del token.', example: 'st_3f1a2b3c4d5e6f708192a3b4c5d6e7f8' })
  @ApiResponse({ status: 200, description: 'Token revocato.', type: ErrorResponse })
  @ApiResponse({ status: 404, description: 'Token non trovato', type: ErrorResponse })
  @ApiResponse({ status: 403, description: 'Richiede un superutente', type: ErrorResponse })
  async revoke(
    @Param('tokenId') tokenId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const user = this.requireSuperUser(req);
      await this.serviceTokenService.revoke(tokenId, user.codiceUtente);
      return RestUtilities.sendOKMessage(res, 'Token di servizio revocato con successo.');
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @Post(':tokenId/rotate')
  @ApiOperation({ summary: 'Ruota un token di servizio', operationId: 'rotateServiceToken' })
  @ApiParam({ name: 'tokenId', description: 'Identificativo del token da sostituire.', example: 'st_3f1a2b3c4d5e6f708192a3b4c5d6e7f8' })
  @ApiResponse({ status: 201, description: 'Nuovo token emesso; il vecchio e revocato.', type: CreateServiceTokenResponse })
  @ApiResponse({ status: 404, description: 'Token non trovato', type: ErrorResponse })
  @ApiResponse({ status: 403, description: 'Richiede un superutente', type: ErrorResponse })
  async rotate(
    @Param('tokenId') tokenId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const user = this.requireSuperUser(req);
      const issued = await this.serviceTokenService.rotate(tokenId, user.codiceUtente);
      return RestUtilities.sendBaseResponse(res, issued, 201);
    } catch (error) {
      return this.sendError(res, error);
    }
  }
}
