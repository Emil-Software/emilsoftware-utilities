import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { RestUtilities } from '../../Utilities';
import {
  ErrorResponse,
  ExchangeFederatedIdentityRequest,
  FederatedExchangeResponse,
} from '../Dtos';
import { RequireServiceTokenScopes, ServiceTokenGuard } from '../security/serviceTokenGuard';
import { FederatedAuthService } from './FederatedAuthService';

/**
 * Scambio service-to-service di un'identita SSO gia verificata.
 *
 * Il backend fratello valida il token del provider e chiama questo endpoint con
 * `{ provider, subject }`; Accessi restituisce la sessione interna e il JWT.
 * Non e un endpoint browser: richiede un service token con scope dedicato.
 */
@ApiTags('Federated authentication')
@ApiBearerAuth()
@Controller('accessi/federated-auth')
@UseGuards(ServiceTokenGuard)
export class FederatedAuthExchangeController {
  constructor(private readonly federatedAuthService: FederatedAuthService) {}

  @Post('exchange')
  @RequireServiceTokenScopes('accessi:federated:exchange')
  @ApiOperation({
    summary: 'Scambia un identita esterna verificata con una sessione Accessi',
    operationId: 'exchangeFederatedIdentity',
    description:
      'Richiede un service token con scope accessi:federated:exchange. Il backend chiamante deve avere gia verificato il token del provider.',
  })
  @ApiBody({ type: ExchangeFederatedIdentityRequest })
  @ApiOkResponse({ type: FederatedExchangeResponse })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'Service token mancante o non valido.' })
  @ApiResponse({ status: 403, type: ErrorResponse, description: 'Scope mancante o identita non abilitata.' })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'Identita non collegata a un utente Accessi.' })
  async exchange(
    @Body() body: ExchangeFederatedIdentityRequest,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const result = await this.federatedAuthService.authenticate({
        provider: body.provider,
        subject: body.subject,
      });
      return RestUtilities.sendBaseResponse(res, result);
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FederatedAuthExchangeController.name);
    }
  }
}
