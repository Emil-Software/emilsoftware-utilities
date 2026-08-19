import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
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
import { AssignPermissionsToUserRequest } from '../Dtos/AssignPermissionsToUserRequest';
import { AssignRolesToUserRequest } from '../Dtos/AssignRolesToUserRequest';
import { GetGroupsWithMenusResponse } from '../Dtos/GetGroupsWithMenusResponse';
import { GetMenusResponse } from '../Dtos/GetMenusResponse';
import { GetRolesResponse } from '../Dtos/GetRolesResponse';
import { Role } from '../Dtos/Role';
import { UserGrantsDto } from '../Dtos/UserGrantsDto';
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
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  private sendControllerError(res: Response, error: unknown) {
    const status =
      error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    return RestUtilities.sendErrorMessage(res, error, PermissionController.name, status);
  }

  @ApiOperation({
    summary: 'Ritorna i ruoli disponibili con i relativi menu',
    operationId: 'getRoles',
    description: 'Recupera tutti i ruoli presenti nel sistema con le relative voci di menu.',
  })
  @ApiOkResponse({ description: 'Elenco dei ruoli con i rispettivi menu', type: GetRolesResponse })
  @ApiInternalServerErrorResponse({ description: 'Errore interno del server' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Lista dei ruoli restituita con successo.' })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Errore interno del server durante il recupero dei ruoli.',
  })
  @Get('roles')
  async getRoles(@Res() res: Response): Promise<void> {
    try {
      const roles = await this.permissionService.getRolesWithMenus();
      RestUtilities.sendBaseResponse(res, roles);
    } catch (error) {
      this.sendControllerError(res, error);
      throw error;
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
  @ApiResponse({ status: 200, description: 'Il ruolo e stato aggiornato con successo' })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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

      if (Number.isNaN(codiceRuolo)) throw new Error('Il codice del ruolo e obbligatorio.');
      if (!role.descrizioneRuolo) throw new Error('La descrizione del ruolo non puo essere vuota.');
      if (!role.menu || role.menu.length === 0) {
        throw new Error('Il ruolo deve avere almeno un menu.');
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
  @ApiResponse({ status: 201, description: 'Il ruolo e stato creato con successo' })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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

      if (!role) throw new Error('Il ruolo non puo essere vuoto.');
      if (!role.descrizioneRuolo) throw new Error('La descrizione del ruolo non puo essere vuota.');
      if (!role.menu || role.menu.length === 0) {
        throw new Error('Il ruolo deve avere almeno un menu.');
      }

      await this.permissionService.updateOrInsertRole(role);
      return RestUtilities.sendOKMessage(res, 'Il ruolo e stato creato con successo.');
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
  @ApiResponse({ status: 200, description: "Ruoli assegnati con successo all'utente" })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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

      if (!assignRolesRequest.roles || assignRolesRequest.roles.length === 0) {
        throw new Error('E necessario fornire almeno un ruolo.');
      }

      await this.permissionService.assignRolesToUser(codiceUtente, assignRolesRequest.roles);
      return RestUtilities.sendOKMessage(
        res,
        `I ruoli ${assignRolesRequest.roles.join(', ')} sono stati assegnati all'utente ${codiceUtente}.`,
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
  @ApiResponse({ status: 200, description: "Abilitazioni assegnate con successo all'utente" })
  @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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

      if (!assignPermissionsRequest.permissions || assignPermissionsRequest.permissions.length === 0) {
        throw new Error('E necessario fornire almeno una abilitazione.');
      }

      await this.permissionService.assignPermissionsToUser(
        codiceUtente,
        assignPermissionsRequest.permissions,
      );
      return RestUtilities.sendOKMessage(
        res,
        `Le abilitazioni sono state assegnate all'utente ${codiceUtente}.`,
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
  @ApiResponse({ status: 200, description: 'Ruolo eliminato con successo' })
  @ApiResponse({ status: 400, description: 'Errore nei parametri della richiesta' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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
  @ApiResponse({ status: 200, description: 'Lista dei menu recuperata con successo' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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
  @ApiResponse({ status: 200, description: 'Lista dei menu recuperata con successo' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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

  @ApiOperation({
    summary: 'Recupera i ruoli e i menu di un utente',
    operationId: 'getUserRolesAndGrants',
  })
  @ApiOkResponse({ description: 'Elenco menu', type: UserGrantsDto })
  @ApiResponse({ status: 200, description: 'Lista dei menu recuperata con successo' })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
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
