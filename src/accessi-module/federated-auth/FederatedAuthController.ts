import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { ActionResponse, ErrorResponse } from '../Dtos/BaseResponse';
import { CreateFederatedIdentityRequest, CreateFederatedProviderRequest, CreateFederatedUserRequest, FederatedIdentityListResponse, FederatedIdentityResponse, FederatedProviderListResponse, FederatedProviderResponse, SetPasswordLoginPolicyRequest, UpdateFederatedIdentityRequest, UpdateFederatedProviderRequest } from '../Dtos/FederatedIdentityDtos';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { ensureSuperUser, getAuthenticatedAccessiUser } from '../security/accessControl';
import { FederatedAuthService } from './FederatedAuthService';

/**
 * Master-only administration API. Authentication itself is intentionally not
 * exposed over HTTP: the hosting backend validates its SSO and calls
 * FederatedAuthService.authenticate({ provider, subject }) directly.
 */
@ApiTags('Federated authentication')
@ApiBearerAuth()
@UseGuards(JwtSimpleGuard)
@Controller('accessi/federated-auth')
export class FederatedAuthController {
  constructor(private readonly federatedAuthService: FederatedAuthService) {}

  @ApiOperation({ summary: 'Elenca i provider SSO censiti', operationId: 'getFederatedProviders', description: 'Riservato a superutente. Restituisce solo catalogo e stato Accessi; issuer, secret e configurazioni SSO restano nel backend.' })
  @ApiOkResponse({ type: FederatedProviderListResponse })
  @Get('providers')
  async getProviders(@Req() request: Request, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      return RestUtilities.sendBaseResponse(res, await this.federatedAuthService.getProviders());
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Censisce un provider SSO', operationId: 'createFederatedProvider', description: 'Riservato a superutente. La chiave provider deve corrispondere alla configurazione stabile del backend; non salvare segreti, issuer o token.' })
  @ApiBody({ type: CreateFederatedProviderRequest })
  @ApiCreatedResponse({ type: FederatedProviderResponse })
  @Post('providers')
  async createProvider(@Req() request: Request, @Body() body: CreateFederatedProviderRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      return RestUtilities.sendBaseResponse(res, await this.federatedAuthService.createProvider(body), HttpStatus.CREATED);
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Aggiorna o disabilita un provider SSO', operationId: 'updateFederatedProvider', description: 'Riservato a superutente. La chiave provider è immutabile: disabilitarla blocca nuovi login SSO ma conserva i collegamenti storici.' })
  @ApiParam({ name: 'provider', example: 'azure-ad-acme-produzione', description: 'Chiave stabile del provider censito.' })
  @ApiBody({ type: UpdateFederatedProviderRequest })
  @ApiOkResponse({ type: FederatedProviderResponse })
  @Patch('providers/:provider')
  async updateProvider(@Req() request: Request, @Param('provider') provider: string, @Body() body: UpdateFederatedProviderRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      return RestUtilities.sendBaseResponse(res, await this.federatedAuthService.updateProvider(provider, body));
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elimina un provider SSO', operationId: 'deleteFederatedProvider', description: 'Riservato a superutente. Consentito solo se nessuna identita e collegata al provider; in alternativa disabilitalo.' })
  @ApiParam({ name: 'provider', example: 'azure-ad-acme-produzione', description: 'Chiave stabile del provider censito.' })
  @ApiOkResponse({ type: ActionResponse })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'Provider non registrato.' })
  @ApiResponse({ status: 409, type: ErrorResponse, description: 'Provider ancora utilizzato da identita collegate.' })
  @Delete('providers/:provider')
  async deleteProvider(@Req() request: Request, @Param('provider') provider: string, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      await this.federatedAuthService.deleteProvider(provider);
      return RestUtilities.sendOKMessage(res, `Provider SSO ${provider} eliminato.`);
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elenca le identita SSO di un utente', operationId: 'getFederatedIdentities', description: 'Riservato a superutente. Non restituisce token esterni o claim del provider.' })
  @ApiParam({ name: 'codiceUtente', example: 123 })
  @ApiOkResponse({ type: FederatedIdentityListResponse })
  @ApiResponse({ status: 403, type: ErrorResponse })
  @Get('users/:codiceUtente/identities')
  async getIdentities(@Req() request: Request, @Param('codiceUtente', ParseIntPipe) codiceUtente: number, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      return RestUtilities.sendBaseResponse(res, await this.federatedAuthService.getUserIdentities(codiceUtente));
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Associa un SSO gia verificato a un utente esistente', operationId: 'linkFederatedIdentity', description: 'Il master deve fornire un provider e subject ottenuti da una verifica SSO lato backend; questo endpoint non verifica token esterni.' })
  @ApiParam({ name: 'codiceUtente', example: 123 })
  @ApiBody({ type: CreateFederatedIdentityRequest })
  @ApiCreatedResponse({ type: FederatedIdentityResponse })
  @Post('users/:codiceUtente/identities')
  async linkIdentity(@Req() request: Request, @Param('codiceUtente', ParseIntPipe) codiceUtente: number, @Body() body: CreateFederatedIdentityRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      const identity = await this.federatedAuthService.linkIdentity(codiceUtente, body, body.note);
      return RestUtilities.sendBaseResponse(res, identity, HttpStatus.CREATED);
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Crea un utente gestito e SSO-only', operationId: 'createFederatedUser', description: 'Riservato a superutente. L utente nasce confermato, con identita collegata e senza password salvo opt-in esplicito.' })
  @ApiBody({ type: CreateFederatedUserRequest })
  @ApiCreatedResponse({ type: FederatedIdentityResponse })
  @ApiResponse({ status: 400, type: ErrorResponse, description: 'Provider o subject non validi.' })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'Provider SSO non censito.' })
  @ApiResponse({ status: 409, type: ErrorResponse, description: 'Email o identità SSO già associate a un utente.' })
  @ApiResponse({ status: 503, type: ErrorResponse, description: 'Schema Accessi non aggiornato.' })
  @ApiResponse({ status: 500, type: ErrorResponse, description: 'Errore inatteso durante il provisioning; la risposta contiene FEDERATED_USER_PROVISIONING_FAILED.' })
  @Post('users')
  async createUser(@Req() request: Request, @Body() body: CreateFederatedUserRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      const identity = await this.federatedAuthService.createManagedFederatedUser(body.user, body, body.passwordLoginEnabled === true, body.note);
      return RestUtilities.sendBaseResponse(res, identity, HttpStatus.CREATED);
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Abilita o disabilita il login con password', operationId: 'setPasswordLoginPolicy', description: 'Con false il login locale restituisce PASSWORD_LOGIN_DISABLED; le identita SSO attive restano utilizzabili.' })
  @ApiParam({ name: 'codiceUtente', example: 123 })
  @ApiBody({ type: SetPasswordLoginPolicyRequest })
  @ApiOkResponse({ type: ActionResponse })
  @Patch('users/:codiceUtente/password-login')
  async setPasswordPolicy(@Req() request: Request, @Param('codiceUtente', ParseIntPipe) codiceUtente: number, @Body() body: SetPasswordLoginPolicyRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      await this.federatedAuthService.setPasswordLoginEnabled(codiceUtente, body.passwordLoginEnabled);
      return RestUtilities.sendOKMessage(res, 'Policy di autenticazione aggiornata.');
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Disabilita un identita SSO', operationId: 'disableFederatedIdentity', description: 'Soft delete: l associazione resta tracciata ma non puo piu autenticare.' })
  @ApiParam({ name: 'identityKey', description: 'SHA-256 restituito dagli endpoint di elenco o creazione.' })
  @ApiOkResponse({ type: ActionResponse })
  @Delete('identities/:identityKey')
  async disableIdentity(@Req() request: Request, @Param('identityKey') identityKey: string, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      await this.federatedAuthService.disableIdentity(identityKey);
      return RestUtilities.sendOKMessage(res, 'Identita SSO disabilitata.');
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elimina definitivamente un collegamento SSO', operationId: 'deleteFederatedIdentityPermanently', description: 'Riservato a superutente. Rimuove il collegamento provider e subject dall’utente, senza eliminare l’utente Accessi.' })
  @ApiParam({ name: 'codiceUtente', example: 123 })
  @ApiParam({ name: 'identityKey', description: 'SHA-256 del collegamento da eliminare.' })
  @ApiOkResponse({ type: ActionResponse })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'Collegamento assente o non appartenente all’utente.' })
  @Delete('users/:codiceUtente/identities/:identityKey')
  async deleteIdentity(@Req() request: Request, @Param('codiceUtente', ParseIntPipe) codiceUtente: number, @Param('identityKey') identityKey: string, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      await this.federatedAuthService.deleteIdentity(codiceUtente, identityKey);
      return RestUtilities.sendOKMessage(res, 'Collegamento SSO eliminato definitivamente.');
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  @ApiOperation({ summary: 'Aggiorna un collegamento SSO', operationId: 'updateFederatedIdentity', description: 'Consente di modificare nota e stato attivo del collegamento. identityKey e una chiave tecnica, non un token SSO.' })
  @ApiParam({ name: 'identityKey', description: 'SHA-256 restituito dagli endpoint di elenco o creazione.' })
  @ApiBody({ type: UpdateFederatedIdentityRequest })
  @ApiOkResponse({ type: ActionResponse })
  @Patch('identities/:identityKey')
  async updateIdentity(@Req() request: Request, @Param('identityKey') identityKey: string, @Body() body: UpdateFederatedIdentityRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request));
      await this.federatedAuthService.updateIdentity(identityKey, body);
      return RestUtilities.sendOKMessage(res, 'Collegamento SSO aggiornato.');
    } catch (error) {
      return this.sendError(res, error);
    }
  }

  private sendError(res: Response, error: unknown) {
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    return RestUtilities.sendErrorMessage(res, error, FederatedAuthController.name, status);
  }
}
