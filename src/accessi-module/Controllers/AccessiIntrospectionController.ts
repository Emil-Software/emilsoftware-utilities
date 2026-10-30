import { Body, Controller, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
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
  IntrospectAccessiTokenRequest,
  IntrospectAccessiTokenResponse,
} from '../Dtos';
import { PermissionService } from '../Services/PermissionService/PermissionService';
import { AuthService } from '../Services/AuthService/AuthService';
import { RequireServiceTokenScopes, ServiceTokenGuard } from '../security/serviceTokenGuard';
import { recordAccessiDuration, recordAccessiMetric } from '../observability/metrics';

/**
 * Endpoint service-to-service per validare un access token Accessi.
 *
 * Non e pensato per il browser: richiede un service token con scope
 * `accessi:introspect`. I backend fratelli lo usano per autorizzare richieste
 * senza accedere al database Accessi.
 */
@ApiTags('ServiceToken')
@ApiBearerAuth()
@Controller('accessi/auth')
@UseGuards(ServiceTokenGuard)
export class AccessiIntrospectionController {
  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
  ) {}

  @Post('introspect')
  @RequireServiceTokenScopes('accessi:introspect')
  @ApiOperation({
    summary: 'Verifica un access token Accessi',
    operationId: 'introspectAccessiToken',
    description:
      'Restituisce active=false per token invalido, scaduto o utente non piu abilitato. Richiede un service token con scope accessi:introspect.',
  })
  @ApiBody({ type: IntrospectAccessiTokenRequest })
  @ApiOkResponse({ description: 'Esito della verifica token.', type: IntrospectAccessiTokenResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Service token mancante o non valido.', type: ErrorResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Scope accessi:introspect mancante.', type: ErrorResponse })
  async introspect(
    @Body() body: IntrospectAccessiTokenRequest,
    @Res() res: Response,
  ): Promise<Response> {
    const startedAt = Date.now();
    try {
      if (!body?.token) {
        recordAccessiMetric('accessi_introspection_total', 1, { result: 'bad_request' });
        return RestUtilities.sendErrorMessage(
          res,
          'Token non fornito.',
          AccessiIntrospectionController.name,
          HttpStatus.BAD_REQUEST,
        );
      }

      const introspection = await this.authService.introspectAccessToken(body.token);
      if (!introspection.active || !introspection.codiceUtente) {
        recordAccessiMetric('accessi_introspection_total', 1, { result: 'inactive' });
        return RestUtilities.sendBaseResponse(res, { active: false });
      }

      const user = (introspection.payload as { utente?: unknown } | undefined)?.utente;
      const grants = await this.permissionService.getUserRolesAndGrants(introspection.codiceUtente);
      recordAccessiMetric('accessi_introspection_total', 1, { result: 'active' });
      return RestUtilities.sendBaseResponse(res, {
        active: true,
        ...(user ? { user } : {}),
        grants,
      });
    } catch (error) {
      recordAccessiMetric('accessi_introspection_total', 1, { result: 'error' });
      return RestUtilities.sendErrorMessage(res, error, AccessiIntrospectionController.name);
    } finally {
      recordAccessiDuration('accessi_introspection_duration_ms', Date.now() - startedAt);
    }
  }
}
