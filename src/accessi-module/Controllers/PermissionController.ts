import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { ActionResponse, ErrorResponse } from '../Dtos/BaseResponse';
import { AssignPermissionsToUserRequest } from '../Dtos/AssignPermissionsToUserRequest';
import { AssignRolesToUserRequest } from '../Dtos/AssignRolesToUserRequest';
import {
  CreateMenuGroupRequest,
  CreateMenuRequest,
  CreateMenuTypeRequest,
  GetMenuTypesResponse,
  UpdateMenuGroupRequest,
  UpdateMenuRequest,
  UpdateMenuTypeRequest,
} from '../Dtos/CatalogDtos';
import { GetGroupsWithMenusResponse } from '../Dtos/GetGroupsWithMenusResponse';
import { GetMenusResponse } from '../Dtos/GetMenusResponse';
import { GetRolesResponse } from '../Dtos/GetRolesResponse';
import { Role } from '../Dtos/Role';
import { UserGrantsResponse } from '../Dtos/UserGrantsResponse';
import { PermissionService } from '../Services/PermissionService/PermissionService';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import {
  ensureSelfOrSuperUser,
  ensureSuperUser,
  getAuthenticatedAccessiUser,
} from '../security/accessControl';

@ApiTags('Permission')
@ApiBearerAuth()
@Controller('accessi/permission')
@UseGuards(JwtSimpleGuard)
/**
 * API amministrative per ruoli, grant e catalogo menu. Le assegnazioni sono sostitutive, non incrementali:
 * il client deve inviare l'intera lista desiderata per non rimuovere voci involontariamente.
 */
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  private sendControllerError(res: Response, error: unknown) {
    // Lo status viene derivato centralmente da RestUtilities (HttpException o 500).
    return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
  }

  @ApiOperation({
    summary: 'Ritorna i ruoli disponibili con i relativi menu',
    operationId: 'getRoles',
    description: 'Recupera tutti i ruoli presenti nel sistema con le relative voci di menu.',
  })
  @ApiOkResponse({ description: 'Elenco dei ruoli con i rispettivi menu', type: GetRolesResponse })
  @ApiInternalServerErrorResponse({ description: 'Errore interno del server', type: ErrorResponse })
  @ApiResponse({ status: HttpStatus.OK, description: 'Lista dei ruoli restituita con successo.', type: GetRolesResponse })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Errore interno del server durante il recupero dei ruoli.',
    type: ErrorResponse,
  })
  @Get('roles')
  async getRoles(@Res() res: Response): Promise<Response> {
    try {
      const roles = await this.permissionService.getRolesWithMenus();
      return RestUtilities.sendBaseResponse(res, roles);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Aggiorna un ruolo esistente', operationId: 'updateRole' })
  @ApiParam({
    name: 'codiceRuolo',
    description: 'Codice identificativo del ruolo da aggiornare',
    required: true,
    example: 101,
    type: Number,
  })
  @ApiBody({
    description: 'Dati aggiornati del ruolo',
    type: Role,
  })
  @ApiResponse({ status: 200, description: 'Il ruolo e stato aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Put('update-role/:codiceRuolo')
  async updateRole(
    @Req() request: Request,
    @Param('codiceRuolo', ParseIntPipe) codiceRuolo: number,
    @Body() role: Role,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono modificare i ruoli.',
      );

      if (Number.isNaN(codiceRuolo)) throw new BadRequestException('Il codice del ruolo e obbligatorio.');
      if (!role.descrizioneRuolo) throw new BadRequestException('La descrizione del ruolo non puo essere vuota.');
      if (!role.menu || role.menu.length === 0) {
        throw new BadRequestException('Il ruolo deve avere almeno un menu.');
      }

      await this.permissionService.updateOrInsertRole(role, codiceRuolo);
      return RestUtilities.sendOKMessage(
        res,
        `Il ruolo ${codiceRuolo} e' stato aggiornato con successo.`,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Crea un nuovo ruolo', operationId: 'createRole' })
  @ApiResponse({ status: 201, description: 'Il ruolo e stato creato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @ApiBody({
    description: 'Dati del nuovo ruolo',
    required: true,
    type: Role,
  })
  @Post('create-role')
  async createRole(@Req() request: Request, @Res() res: Response, @Body() role: Role) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono creare ruoli.',
      );

      if (!role) throw new BadRequestException('Il ruolo non puo essere vuoto.');
      if (!role.descrizioneRuolo) throw new BadRequestException('La descrizione del ruolo non puo essere vuota.');
      if (!role.menu || role.menu.length === 0) {
        throw new BadRequestException('Il ruolo deve avere almeno un menu.');
      }

      await this.permissionService.updateOrInsertRole(role);
      return RestUtilities.sendOKMessage(res, 'Il ruolo e stato creato con successo.', HttpStatus.CREATED);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Assegna piu ruoli a un utente', operationId: 'assignRolesToUser' })
  @ApiParam({
    name: 'codiceUtente',
    description: "Codice identificativo dell'utente a cui assegnare i ruoli",
    required: true,
    example: 22,
  })
  @ApiBody({
    type: AssignRolesToUserRequest,
    description: "Lista dei ruoli da assegnare all'utente",
  })
  @ApiResponse({ status: 200, description: "Ruoli assegnati con successo all'utente", type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Post('assign-roles/:codiceUtente')
  async assignRolesToUser(
    @Req() request: Request,
    @Res() res: Response,
    @Param('codiceUtente', ParseIntPipe) codiceUtente: number,
    @Body() assignRolesRequest: AssignRolesToUserRequest,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono assegnare ruoli agli utenti.',
      );

      await this.permissionService.assignRolesToUser(codiceUtente, assignRolesRequest.roles);
      const responseMessage =
        assignRolesRequest.roles.length === 0
          ? `Tutti i ruoli sono stati rimossi dall'utente ${codiceUtente}.`
          : `I ruoli ${assignRolesRequest.roles.join(', ')} sono stati assegnati all'utente ${codiceUtente}.`;
      return RestUtilities.sendOKMessage(
        res,
        responseMessage,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Assegna abilitazioni dirette a un utente',
    operationId: 'assignPermissionsToUser',
  })
  @ApiParam({
    name: 'codiceUtente',
    description: "Codice identificativo dell'utente a cui assegnare le abilitazioni",
    required: true,
    example: 22,
  })
  @ApiBody({
    type: AssignPermissionsToUserRequest,
    description: "Lista delle abilitazioni da assegnare all'utente",
  })
  @ApiResponse({ status: 200, description: "Abilitazioni assegnate con successo all'utente", type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Post('assign-permissions/:codiceUtente')
  async assignPermissionsToUser(
    @Req() request: Request,
    @Res() res: Response,
    @Param('codiceUtente', ParseIntPipe) codiceUtente: number,
    @Body() assignPermissionsRequest: AssignPermissionsToUserRequest,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono assegnare permessi agli utenti.',
      );

      await this.permissionService.assignPermissionsToUser(
        codiceUtente,
        assignPermissionsRequest.permissions,
      );
      const responseMessage =
        assignPermissionsRequest.permissions.length === 0
          ? `Tutte le abilitazioni sono state rimosse dall'utente ${codiceUtente}.`
          : `Le abilitazioni sono state assegnate all'utente ${codiceUtente}.`;
      return RestUtilities.sendOKMessage(
        res,
        responseMessage,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elimina un ruolo esistente', operationId: 'deleteRole' })
  @ApiParam({
    name: 'codiceRuolo',
    description: 'Codice identificativo del ruolo da eliminare',
    required: true,
    example: 382,
    type: Number,
  })
  @ApiResponse({ status: 200, description: 'Ruolo eliminato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Errore nei parametri della richiesta', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Delete('delete-role/:codiceRuolo')
  async deleteRole(
    @Req() request: Request,
    @Param('codiceRuolo', ParseIntPipe) codiceRuolo: number,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono eliminare ruoli.',
      );

      await this.permissionService.deleteRole(codiceRuolo);
      return RestUtilities.sendOKMessage(
        res,
        `Il ruolo ${codiceRuolo} e' stato eliminato con successo.`,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Recupera tutti i menu disponibili', operationId: 'getMenus' })
  @ApiOkResponse({ description: 'Elenco menu', type: GetMenusResponse })
  @ApiResponse({ status: 200, description: 'Lista dei menu recuperata con successo', type: GetMenusResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Get('menus')
  async getMenus(@Res() res: Response) {
    try {
      const menus = await this.permissionService.getMenus();
      return RestUtilities.sendBaseResponse(res, menus);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Recupera tutti i gruppi disponibili con i relativi menu',
    operationId: 'getGroupsWithMenus',
  })
  @ApiOkResponse({
    description: 'Elenco gruppi con relativi menu',
    type: GetGroupsWithMenusResponse,
  })
  @ApiResponse({ status: 200, description: 'Lista dei menu recuperata con successo', type: GetGroupsWithMenusResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @ApiQuery({
    name: 'includeDisabled',
    required: false,
    type: Boolean,
    description: 'Quando true ritorna anche i menu e gruppi disabilitati.',
  })
  @Get('groups-with-menus')
  async getGroupsWithMenus(@Query('includeDisabled') includeDisabled: string, @Res() res: Response) {
    try {
      const includeDisabledFlag =
        typeof includeDisabled === 'string'
          ? ['true', '1', 'yes'].includes(includeDisabled.toLowerCase())
          : false;

      const menus = await this.permissionService.getGroupsWithMenus(includeDisabledFlag);
      return RestUtilities.sendBaseResponse(res, menus);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  // -------------------------------------------------------------------------
  // Gestione catalogo: tipi menu, gruppi, menu. Operazioni riservate al superutente.
  // -------------------------------------------------------------------------

  @ApiOperation({ summary: 'Recupera il catalogo dei tipi menu', operationId: 'getMenuTypes' })
  @ApiOkResponse({ description: 'Elenco dei tipi menu', type: GetMenuTypesResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Get('menu-types')
  async getMenuTypes(@Res() res: Response) {
    try {
      const types = await this.permissionService.getMenuTypes();
      return RestUtilities.sendBaseResponse(res, types);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Crea un nuovo menu', operationId: 'createMenu' })
  @ApiBody({ type: CreateMenuRequest, description: 'Dati del nuovo menu' })
  @ApiResponse({ status: 201, description: 'Menu creato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Post('menus')
  async createMenu(@Req() request: Request, @Body() body: CreateMenuRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono creare menu.');
      await this.permissionService.createMenu(body);
      return RestUtilities.sendOKMessage(
        res,
        `Il menu ${body.codiceMenu} e' stato creato con successo.`,
        HttpStatus.CREATED,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Aggiorna un menu esistente', operationId: 'updateMenu' })
  @ApiParam({ name: 'codiceMenu', description: 'Codice del menu da aggiornare', required: true, example: 'MNU001' })
  @ApiBody({ type: UpdateMenuRequest, description: 'Campi del menu da aggiornare' })
  @ApiResponse({ status: 200, description: 'Menu aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Put('menus/:codiceMenu')
  async updateMenu(
    @Req() request: Request,
    @Param('codiceMenu') codiceMenu: string,
    @Body() body: UpdateMenuRequest,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono modificare menu.');
      await this.permissionService.updateMenu(codiceMenu, body);
      return RestUtilities.sendOKMessage(res, `Il menu ${codiceMenu} e' stato aggiornato con successo.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elimina un menu', operationId: 'deleteMenu' })
  @ApiParam({ name: 'codiceMenu', description: 'Codice del menu da eliminare', required: true, example: 'MNU001' })
  @ApiResponse({ status: 200, description: 'Menu eliminato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Delete('menus/:codiceMenu')
  async deleteMenu(@Req() request: Request, @Param('codiceMenu') codiceMenu: string, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono eliminare menu.');
      await this.permissionService.deleteMenu(codiceMenu);
      return RestUtilities.sendOKMessage(res, `Il menu ${codiceMenu} e' stato eliminato con successo.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Crea un nuovo gruppo menu', operationId: 'createMenuGroup' })
  @ApiBody({ type: CreateMenuGroupRequest, description: 'Dati del nuovo gruppo' })
  @ApiResponse({ status: 201, description: 'Gruppo creato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Post('menu-groups')
  async createMenuGroup(@Req() request: Request, @Body() body: CreateMenuGroupRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono creare gruppi.');
      await this.permissionService.createMenuGroup(body);
      return RestUtilities.sendOKMessage(
        res,
        `Il gruppo ${body.codiceGruppo} e' stato creato con successo.`,
        HttpStatus.CREATED,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Aggiorna un gruppo menu', operationId: 'updateMenuGroup' })
  @ApiParam({ name: 'codiceGruppo', description: 'Codice del gruppo da aggiornare', required: true, example: 'A' })
  @ApiBody({ type: UpdateMenuGroupRequest, description: 'Campi del gruppo da aggiornare' })
  @ApiResponse({ status: 200, description: 'Gruppo aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Put('menu-groups/:codiceGruppo')
  async updateMenuGroup(
    @Req() request: Request,
    @Param('codiceGruppo') codiceGruppo: string,
    @Body() body: UpdateMenuGroupRequest,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono modificare gruppi.');
      await this.permissionService.updateMenuGroup(codiceGruppo, body);
      return RestUtilities.sendOKMessage(res, `Il gruppo ${codiceGruppo} e' stato aggiornato con successo.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elimina un gruppo menu', operationId: 'deleteMenuGroup' })
  @ApiParam({ name: 'codiceGruppo', description: 'Codice del gruppo da eliminare', required: true, example: 'A' })
  @ApiResponse({ status: 200, description: 'Gruppo eliminato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Delete('menu-groups/:codiceGruppo')
  async deleteMenuGroup(@Req() request: Request, @Param('codiceGruppo') codiceGruppo: string, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono eliminare gruppi.');
      await this.permissionService.deleteMenuGroup(codiceGruppo);
      return RestUtilities.sendOKMessage(res, `Il gruppo ${codiceGruppo} e' stato eliminato con successo.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Crea un nuovo tipo menu', operationId: 'createMenuType' })
  @ApiBody({ type: CreateMenuTypeRequest, description: 'Dati del nuovo tipo menu' })
  @ApiResponse({ status: 201, description: 'Tipo menu creato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Post('menu-types')
  async createMenuType(@Req() request: Request, @Body() body: CreateMenuTypeRequest, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono creare tipi menu.');
      await this.permissionService.createMenuType(body);
      return RestUtilities.sendOKMessage(
        res,
        `Il tipo menu ${body.codiceTipo} e' stato creato con successo.`,
        HttpStatus.CREATED,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Aggiorna un tipo menu', operationId: 'updateMenuType' })
  @ApiParam({ name: 'codiceTipo', description: 'Codice del tipo menu da aggiornare', required: true, example: 'A' })
  @ApiBody({ type: UpdateMenuTypeRequest, description: 'Campi del tipo menu da aggiornare' })
  @ApiResponse({ status: 200, description: 'Tipo menu aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Put('menu-types/:codiceTipo')
  async updateMenuType(
    @Req() request: Request,
    @Param('codiceTipo') codiceTipo: string,
    @Body() body: UpdateMenuTypeRequest,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono modificare tipi menu.');
      await this.permissionService.updateMenuType(codiceTipo, body);
      return RestUtilities.sendOKMessage(res, `Il tipo menu ${codiceTipo} e' stato aggiornato con successo.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({ summary: 'Elimina un tipo menu', operationId: 'deleteMenuType' })
  @ApiParam({ name: 'codiceTipo', description: 'Codice del tipo menu da eliminare', required: true, example: 'A' })
  @ApiResponse({ status: 200, description: 'Tipo menu eliminato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Delete('menu-types/:codiceTipo')
  async deleteMenuType(@Req() request: Request, @Param('codiceTipo') codiceTipo: string, @Res() res: Response) {
    try {
      ensureSuperUser(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono eliminare tipi menu.');
      await this.permissionService.deleteMenuType(codiceTipo);
      return RestUtilities.sendOKMessage(res, `Il tipo menu ${codiceTipo} e' stato eliminato con successo.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Recupera i ruoli e i menu di un utente',
    operationId: 'getUserRolesAndGrants',
  })
  @ApiOkResponse({ description: 'Elenco grant utente', type: UserGrantsResponse })
  @ApiResponse({ status: 200, description: 'Grant utente recuperati con successo', type: UserGrantsResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  @Get('grants/:codiceUtente')
  async getUserRolesAndGrants(
    @Req() request: Request,
    @Param('codiceUtente', ParseIntPipe) codiceUtente: number,
    @Res() res: Response,
  ) {
    try {
      ensureSelfOrSuperUser(
        getAuthenticatedAccessiUser(request),
        codiceUtente,
        'Puoi consultare solo i tuoi grant, salvo privilegi amministrativi.',
      );

      const menus = await this.permissionService.getUserRolesAndGrants(codiceUtente);
      return RestUtilities.sendBaseResponse(res, menus);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }
}
