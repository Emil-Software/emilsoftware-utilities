import {
    Body,
    Controller,
    Get,
    Inject,
    Param,
    Patch,
    Req,
    Res,
} from '@nestjs/common';
import {
    ApiBody,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { UpdateEnabledStatusRequest } from '../Dtos';
import { ConfiguratorService } from '../Services/ConfiguratorService/ConfiguratorService';
import { UserService } from '../Services/UserService/UserService';
import * as jwt from 'jsonwebtoken';

@ApiTags('Configurator')
@Controller('accessi/configurator')
export class ConfiguratorController {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
    private userService: UserService,
    private configuratorService: ConfiguratorService
) {}

  @ApiOperation({
    summary: 'Aggiorna lo stato di abilitazione di un menù',
    operationId: 'setMenuEnabled',
  })
  @ApiParam({
    name: 'codiceMenu',
    description: 'Codice identificativo del menù da aggiornare',
    required: true,
    example: 'MNU001',
  })
  @ApiBody({ type: UpdateEnabledStatusRequest })
  @ApiResponse({ status: 200, description: 'Stato del menù aggiornato con successo' })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
  @ApiResponse({ status: 403, description: "Utente non autorizzato ad eseguire l'operazione" })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
  @Patch('menus/:codiceMenu/enabled')
  async setMenuEnabled(
    @Param('codiceMenu') codiceMenu: string,
    @Body() body: UpdateEnabledStatusRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      if (!codiceMenu) throw new Error('Il codice del menù è obbligatorio.');
      if (body?.enabled === undefined) throw new Error('Lo stato di abilitazione è obbligatorio.');

      let codiceUtente: number;
      try {
        codiceUtente = this.extractUserCodeFromRequest(req);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Token non valido.';
        return RestUtilities.sendErrorMessage(res, message, ConfiguratorController.name, 401);
      }
      const canConfigure = await this.userService.isAdminConfigurator(codiceUtente);
      if (!canConfigure) {
        return RestUtilities.sendErrorMessage(
          res,
          'Utente non autorizzato ad aggiornare i menù.',
          ConfiguratorController.name,
          403,
        );
      }

      await this.configuratorService.setMenuEnabled(codiceMenu, body.enabled);

      const action = body.enabled ? 'abilitato' : 'disabilitato';
      return RestUtilities.sendOKMessage(
        res,
        `Il menù ${codiceMenu} è stato ${action} con successo.`,
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, ConfiguratorController.name);
    }
  }

  @ApiOperation({
    summary: 'Aggiorna lo stato di abilitazione di un gruppo menù',
    operationId: 'setGroupEnabled',
  })
  @ApiParam({
    name: 'codiceGruppo',
    description: 'Codice identificativo del gruppo da aggiornare',
    required: true,
    example: 'GRP01',
  })
  @ApiBody({ type: UpdateEnabledStatusRequest })
  @ApiResponse({ status: 200, description: 'Stato del gruppo aggiornato con successo' })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
  @ApiResponse({ status: 403, description: "Utente non autorizzato ad eseguire l'operazione" })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
  @Patch('groups/:codiceGruppo/enabled')
  async setGroupEnabled(
    @Param('codiceGruppo') codiceGruppo: string,
    @Body() body: UpdateEnabledStatusRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      if (!codiceGruppo) throw new Error('Il codice del gruppo è obbligatorio.');
      if (body?.enabled === undefined) throw new Error('Lo stato di abilitazione è obbligatorio.');

      let codiceUtente: number;
      try {
        codiceUtente = this.extractUserCodeFromRequest(req);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Token non valido.';
        return RestUtilities.sendErrorMessage(res, message, ConfiguratorController.name, 401);
      }
      const canConfigure = await this.userService.isAdminConfigurator(codiceUtente);
      if (!canConfigure) {
        return RestUtilities.sendErrorMessage(
          res,
          'Utente non autorizzato ad aggiornare i gruppi menù.',
          ConfiguratorController.name,
          403,
        );
      }

      await this.configuratorService.setGroupEnabled(codiceGruppo, body.enabled);

      const action = body.enabled ? 'abilitato' : 'disabilitato';
      return RestUtilities.sendOKMessage(
        res,
        `Il gruppo ${codiceGruppo} è stato ${action} con successo.`,
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, ConfiguratorController.name);
    }
  }

  @ApiOperation({
    summary: 'Recupera lo stato di abilitazione di un menù',
    operationId: 'getMenuEnabled',
  })
  @ApiParam({
    name: 'codiceMenu',
    description: 'Codice identificativo del menù da recuperare',
    required: true,
    example: 'MNU001',
  })
  @ApiResponse({ status: 200, description: 'Stato del menù recuperato con successo' })
  @ApiResponse({ status: 403, description: "Utente non autorizzato ad eseguire l'operazione" })
  @ApiResponse({ status: 404, description: 'Menù non trovato' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
  @Get('menus/:codiceMenu/enabled')
  async getMenuEnabled(
    @Param('codiceMenu') codiceMenu: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      if (!codiceMenu) throw new Error('Il codice del menù è obbligatorio.');

      let codiceUtente: number;
      try {
        codiceUtente = this.extractUserCodeFromRequest(req);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Token non valido.';
        return RestUtilities.sendErrorMessage(res, message, ConfiguratorController.name, 401);
      }
      const canConfigure = await this.userService.isAdminConfigurator(codiceUtente);
      if (!canConfigure) {
        return RestUtilities.sendErrorMessage(
          res,
          'Utente non autorizzato a consultare i menù.',
          ConfiguratorController.name,
          403,
        );
      }

      const enabled = await this.configuratorService.getMenuEnabledStatus(codiceMenu);
      if (enabled === null) {
        return RestUtilities.sendErrorMessage(
          res,
          `Menù ${codiceMenu} non trovato.`,
          ConfiguratorController.name,
          404,
        );
      }

      return RestUtilities.sendBaseResponse(res, {
        codiceMenu,
        enabled,
      });
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, ConfiguratorController.name);
    }
  }

  @ApiOperation({
    summary: 'Recupera lo stato di abilitazione di un gruppo menù',
    operationId: 'getGroupEnabled',
  })
  @ApiParam({
    name: 'codiceGruppo',
    description: 'Codice identificativo del gruppo da recuperare',
    required: true,
    example: 'GRP01',
  })
  @ApiResponse({ status: 200, description: 'Stato del gruppo recuperato con successo' })
  @ApiResponse({ status: 403, description: "Utente non autorizzato ad eseguire l'operazione" })
  @ApiResponse({ status: 404, description: 'Gruppo non trovato' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
  @Get('groups/:codiceGruppo/enabled')
  async getGroupEnabled(
    @Param('codiceGruppo') codiceGruppo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      if (!codiceGruppo) throw new Error('Il codice del gruppo è obbligatorio.');

      let codiceUtente: number;
      try {
        codiceUtente = this.extractUserCodeFromRequest(req);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Token non valido.';
        return RestUtilities.sendErrorMessage(res, message, ConfiguratorController.name, 401);
      }
      const canConfigure = await this.userService.isAdminConfigurator(codiceUtente);
      if (!canConfigure) {
        return RestUtilities.sendErrorMessage(
          res,
          'Utente non autorizzato a consultare i gruppi menù.',
          ConfiguratorController.name,
          403,
        );
      }

      const enabled = await this.configuratorService.getGroupEnabledStatus(codiceGruppo);
      if (enabled === null) {
        return RestUtilities.sendErrorMessage(
          res,
          `Gruppo ${codiceGruppo} non trovato.`,
          ConfiguratorController.name,
          404,
        );
      }

      return RestUtilities.sendBaseResponse(res, {
        codiceGruppo,
        enabled,
      });
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, ConfiguratorController.name);
    }
  }

  private extractUserCodeFromRequest(req: Request): number {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      throw new Error('Authorization header mancante.');
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new Error('Token di autorizzazione non valido.');
    }

    const decoded = jwt.verify(token, this.options.jwtOptions.secret) as jwt.JwtPayload & {
      utente?: { codiceUtente?: number };
    };

    const codiceUtente = decoded?.utente?.codiceUtente;
    if (!codiceUtente) {
      throw new Error('Dati utente non presenti nel token.');
    }

    return codiceUtente;
  }
}

