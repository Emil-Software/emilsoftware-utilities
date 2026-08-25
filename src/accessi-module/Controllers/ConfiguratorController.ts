import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { ActionResponse, ErrorResponse, UpdateEnabledStatusRequest } from '../Dtos';
import { ConfiguratorService } from '../Services/ConfiguratorService/ConfiguratorService';
import { UserService } from '../Services/UserService/UserService';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { getAuthenticatedAccessiUser } from '../security/accessControl';

@ApiBearerAuth()
@ApiTags('Configurator')
@Controller('accessi/configurator')
@UseGuards(JwtSimpleGuard)
export class ConfiguratorController {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
    private userService: UserService,
    private configuratorService: ConfiguratorService,
  ) {}

  @ApiOperation({
    summary: 'Aggiorna lo stato di abilitazione di un menu',
    operationId: 'setMenuEnabled',
  })
  @ApiParam({
    name: 'codiceMenu',
    description: 'Codice identificativo del menu da aggiornare',
    required: true,
    example: 'MNU001',
  })
  @ApiBody({ type: UpdateEnabledStatusRequest })
  @ApiResponse({ status: 200, description: 'Stato del menu aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati', type: ErrorResponse })
  @ApiResponse({ status: 401, description: 'Utente non autenticato o token non valido', type: ErrorResponse })
  @ApiResponse({ status: 403, description: "Utente non autorizzato ad eseguire l'operazione", type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Patch('menus/:codiceMenu/enabled')
  async setMenuEnabled(
    @Param('codiceMenu') codiceMenu: string,
    @Body() body: UpdateEnabledStatusRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      if (!codiceMenu) throw new Error('Il codice del menu e obbligatorio.');
      if (body?.enabled === undefined) throw new Error('Lo stato di abilitazione e obbligatorio.');

      const authenticatedUser = getAuthenticatedAccessiUser(req);

      const canConfigure =
        authenticatedUser.flagSuper ||
        authenticatedUser.flagAdminConfigurator ||
        (await this.userService.isAdminConfigurator(authenticatedUser.codiceUtente));
      if (!canConfigure) {
        return RestUtilities.sendErrorMessage(
          res,
          'Utente non autorizzato ad aggiornare i menu.',
          ConfiguratorController.name,
          403,
        );
      }

      await this.configuratorService.setMenuEnabled(codiceMenu, body.enabled);

      const action = body.enabled ? 'abilitato' : 'disabilitato';
      return RestUtilities.sendOKMessage(
        res,
        `Il menu ${codiceMenu} e stato ${action} con successo.`,
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, ConfiguratorController.name);
    }
  }

  @ApiOperation({
    summary: 'Aggiorna lo stato di abilitazione di un gruppo menu',
    operationId: 'setGroupEnabled',
  })
  @ApiParam({
    name: 'codiceGruppo',
    description: 'Codice identificativo del gruppo da aggiornare',
    required: true,
    example: 'GRP01',
  })
  @ApiBody({ type: UpdateEnabledStatusRequest })
  @ApiResponse({ status: 200, description: 'Stato del gruppo aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati', type: ErrorResponse })
  @ApiResponse({ status: 401, description: 'Utente non autenticato o token non valido', type: ErrorResponse })
  @ApiResponse({ status: 403, description: "Utente non autorizzato ad eseguire l'operazione", type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Patch('groups/:codiceGruppo/enabled')
  async setGroupEnabled(
    @Param('codiceGruppo') codiceGruppo: string,
    @Body() body: UpdateEnabledStatusRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      if (!codiceGruppo) throw new Error('Il codice del gruppo e obbligatorio.');
      if (body?.enabled === undefined) throw new Error('Lo stato di abilitazione e obbligatorio.');

      const authenticatedUser = getAuthenticatedAccessiUser(req);

      const canConfigure =
        authenticatedUser.flagSuper ||
        authenticatedUser.flagAdminConfigurator ||
        (await this.userService.isAdminConfigurator(authenticatedUser.codiceUtente));
      if (!canConfigure) {
        return RestUtilities.sendErrorMessage(
          res,
          'Utente non autorizzato ad aggiornare i gruppi menu.',
          ConfiguratorController.name,
          403,
        );
      }

      await this.configuratorService.setGroupEnabled(codiceGruppo, body.enabled);

      const action = body.enabled ? 'abilitato' : 'disabilitato';
      return RestUtilities.sendOKMessage(
        res,
        `Il gruppo ${codiceGruppo} e stato ${action} con successo.`,
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, ConfiguratorController.name);
    }
  }
}
