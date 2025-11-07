import { Body, Controller, Delete, Get, HttpStatus, Inject, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBody, ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { PermissionService } from '../Services/PermissionService/PermissionService';
import { Role } from '../Dtos/Role';
import { AssignRolesToUserRequest } from '../Dtos/AssignRolesToUserRequest';
import { AssignPermissionsToUserRequest } from '../Dtos/AssignPermissionsToUserRequest';
import { BaseResponse } from '../Dtos';
import { GetMenusResponse, MenuEntity } from '../Dtos/GetMenusResponse';
import { GetRolesResponse } from '../Dtos/GetRolesResponse';
import { UserGrantsDto } from '../Dtos/UserGrantsDto';
import { GetGroupsWithMenusResponse } from '../Dtos/GetGroupsWithMenusResponse';


@ApiTags('Permission')
@Controller('accessi/permission')
export class PermissionController {
    constructor(
        private readonly permissionService: PermissionService,
        @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions
    ) { }

    /*
        @ApiOperation({ summary: 'Resetta le abilitazioni di un utente', operationId: "resetAbilitazioni" })
        @Post('reset-abilitazioni')
        async resetAbilitazioni(@Body('codiceUtente') codiceUtente: number, @Res() res: Response) {
            try {
                await this.permissionService.resetAbilitazioni(codiceUtente);
                RestUtilities.sendOKMessage(res, `Le abilitazioni dell'utente ${codiceUtente} sono state resettate con successo.`);
            } catch (error) {
                RestUtilities.sendErrorMessage(res, error, PermissionController.name);
                throw error;
            }
        }
    */


    /**
     * @description Endpoint per ottenere tutti i ruoli con i relativi menù.
     * @returns Un array di ruoli con menù associati.
     */
    @ApiOperation({ summary: 'Ritorna i ruoli disponibili con i relativi menù', operationId: "getRoles", description: 'Recupera tutti i ruoli presenti nel sistema con le relative voci di menu accessibili.' })
    @ApiOkResponse({ description: 'Elenco dei ruoli con i rispettivi menù', type: GetRolesResponse })
    @ApiInternalServerErrorResponse({ description: 'Errore interno del server' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Lista dei ruoli con i menù restituita con successo.' })
    @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Errore interno del server durante il recupero dei ruoli.' })
    @Get('roles')
    async getRoles(@Res() res: Response): Promise<void> {
        try {
            const roles = await this.permissionService.getRolesWithMenus();
            RestUtilities.sendBaseResponse(res, roles);
        } catch (error) {
            RestUtilities.sendErrorMessage(res, error, PermissionController.name);
            throw error;
        }
    }

    @ApiOperation({ summary: 'Aggiorna un ruolo esistente', operationId: "updateRole" })
    @ApiParam({
        name: 'codiceRuolo',
        description: "Codice identificativo del ruolo da aggiornare",
        required: true,
        example: 101,
        type: Number
    })
    @ApiBody({
        description: "Dati aggiornati del ruolo (escluso il codice ruolo, che è nel path)",
        type: Role
    })
    @ApiResponse({ status: 200, description: "Il ruolo è stato aggiornato con successo" })
    @ApiResponse({ status: 400, description: "Errore di validazione nei dati inviati" })
    @ApiResponse({ status: 500, description: "Errore interno del server" })
    @Put('update-role/:codiceRuolo')
    async updateRole(
        @Param('codiceRuolo', ParseIntPipe) codiceRuolo: number,
        @Body() role: Role,
        @Res() res: Response
    ) {
        try {
            if (Number.isNaN(codiceRuolo)) throw new Error("Il codice del ruolo è obbligatorio.");
            if (!role.descrizioneRuolo) throw new Error("La descrizione del ruolo non può essere vuota.");
            if (!role.menu || role.menu.length === 0) throw new Error("Il ruolo deve avere almeno un menù.");

            await this.permissionService.updateOrInsertRole(role, codiceRuolo);
            return RestUtilities.sendOKMessage(res, `Il ruolo ${codiceRuolo} è stato aggiornato con successo.`);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }

    @ApiOperation({ summary: 'Crea un nuovo ruolo', operationId: "createRole" })
    @ApiResponse({ status: 201, description: 'Il ruolo è stato creato con successo' })
    @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
    @ApiResponse({ status: 500, description: 'Errore interno del server' })
    @ApiBody({
        description: 'Dati del nuovo ruolo',
        required: true,
        type: Role
    })
    @Post('create-role')
    async createRole(@Res() res: Response, @Body() role: Role) {
        try {
            if (!role) throw new Error("Il ruolo non può essere vuoto.");
            if (!role.descrizioneRuolo) throw new Error("La descrizione del ruolo non può essere vuota.");
            if (!role.menu || role.menu.length === 0) throw new Error("Il ruolo deve avere almeno un menù.");

            await this.permissionService.updateOrInsertRole(role);
            return RestUtilities.sendOKMessage(res, "Il ruolo è stato creato con successo.");
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }


    @ApiOperation({ summary: 'Assegna più ruoli a un utente', operationId: "assignRolesToUser" })
    @ApiParam({
        name: 'codiceUtente',
        description: 'Codice identificativo dell\'utente a cui assegnare i ruoli',
        required: true,
        example: 22
    })
    @ApiBody({
        type: AssignRolesToUserRequest,
        description: 'Lista dei ruoli da assegnare all\'utente'
    })
    @ApiResponse({ status: 200, description: 'Ruoli assegnati con successo all\'utente' })
    @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
    @ApiResponse({ status: 500, description: 'Errore interno del server' })
    @Post('assign-roles/:codiceUtente')
    async assignRolesToUser(
        @Res() res: Response,
        @Param('codiceUtente') codiceUtente: number,
        @Body() assignRolesRequest: AssignRolesToUserRequest
    ) {
        try {
            if (!codiceUtente) throw new Error("Il codice utente è obbligatorio.");
            if (!assignRolesRequest.roles || assignRolesRequest.roles.length === 0) {
                throw new Error("È necessario fornire almeno un ruolo.");
            }

            await this.permissionService.assignRolesToUser(codiceUtente, assignRolesRequest.roles);
            return RestUtilities.sendOKMessage(res, `I ruoli ${assignRolesRequest.roles.join(', ')} sono stati assegnati all'utente ${codiceUtente}.`);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }


    @ApiOperation({ summary: 'Assegna abilitazioni dirette a un utente', operationId: "assignPermissionsToUser" })
    @ApiParam({
        name: 'codiceUtente',
        description: 'Codice identificativo dell\'utente a cui assegnare le abilitazioni',
        required: true,
        example: 'USR123'
    })
    @ApiBody({
        type: AssignPermissionsToUserRequest,
        description: 'Lista delle abilitazioni da assegnare all\'utente'
    })
    @ApiResponse({ status: 200, description: 'Abilitazioni assegnate con successo all\'utente' })
    @ApiResponse({ status: 400, description: 'Errore di validazione nei dati inviati' })
    @ApiResponse({ status: 500, description: 'Errore interno del server' })
    @Post('assign-permissions/:codiceUtente')
    async assignPermissionsToUser(
        @Res() res: Response,
        @Param('codiceUtente') codiceUtente: number,
        @Body() assignPermissionsRequest: AssignPermissionsToUserRequest
    ) {
        try {
            if (!codiceUtente) throw new Error("Il codice utente è obbligatorio.");
            if (!assignPermissionsRequest.permissions || assignPermissionsRequest.permissions.length === 0) {
                throw new Error("È necessario fornire almeno un'abilitazione.");
            }

            await this.permissionService.assignPermissionsToUser(codiceUtente, assignPermissionsRequest.permissions);
            return RestUtilities.sendOKMessage(res, `Le abilitazioni sono state assegnate all'utente ${codiceUtente}.`);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }


    @ApiOperation({ summary: 'Elimina un ruolo esistente', operationId: "deleteRole" })
    @ApiParam({
        name: 'codiceRuolo',
        description: "Codice identificativo del ruolo da eliminare",
        required: true,
        example: 382,
        type: Number
    })
    @ApiResponse({ status: 200, description: "Ruolo eliminato con successo" })
    @ApiResponse({ status: 400, description: "Errore nei parametri della richiesta" })
    @ApiResponse({ status: 500, description: "Errore interno del server" })
    @Delete('delete-role/:codiceRuolo')
    async deleteRole(@Param('codiceRuolo', ParseIntPipe) codiceRuolo: number, @Res() res: Response) {
        try {
            if (Number.isNaN(codiceRuolo)) throw new Error("Il codice del ruolo è obbligatorio.");

            await this.permissionService.deleteRole(codiceRuolo);
            return RestUtilities.sendOKMessage(res, `Il ruolo ${codiceRuolo} è stato eliminato con successo.`);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }


    @ApiOperation({ summary: 'Recupera tutti i menù disponibili', operationId: "getMenus" })
    @ApiOkResponse({ description: 'Elenco menù', type: GetMenusResponse })
    @ApiResponse({ status: 200, description: "Lista dei menù recuperata con successo" })
    @ApiResponse({ status: 500, description: "Errore interno del server" })
    @Get('menus')
    async getMenus(@Res() res: Response) {
        try {
            const menus = await this.permissionService.getMenus();
            return RestUtilities.sendBaseResponse(res, menus);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }

    @ApiOperation({ summary: 'Recupera tutti i gruppi disponibili con i relativi menù', operationId: "getGroupsWithMenus" })
    @ApiOkResponse({ description: 'Elenco gruppi con relativi menù', type: GetGroupsWithMenusResponse })
    @ApiResponse({ status: 200, description: "Lista dei menù recuperata con successo" })
    @ApiResponse({ status: 500, description: "Errore interno del server" })
    @ApiQuery({
        name: 'includeDisabled',
        required: false,
        type: Boolean,
        description: 'Quando true ritorna anche i menu e gruppi disabilitati.'
    })
    @Get('groups-with-menus')
    async getGroupsWithMenus(@Query('includeDisabled') includeDisabled: string, @Res() res: Response) {
        try {
            const includeDisabledFlag = typeof includeDisabled === 'string'
                ? ['true', '1', 'yes'].includes(includeDisabled.toLowerCase())
                : false;

            const menus = await this.permissionService.getGroupsWithMenus(includeDisabledFlag);
            return RestUtilities.sendBaseResponse(res, menus);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }


    @ApiOperation({ summary: 'Recupera i ruoli e i menù di un utente', operationId: "getUserRolesAndGrants" })
    @ApiOkResponse({ description: 'Elenco menù', type: UserGrantsDto })
    @ApiResponse({ status: 200, description: "Lista dei menù recuperata con successo" })
    @ApiResponse({ status: 500, description: "Errore interno del server" })
    @Get('grants/:codiceUtente')
    async getUserRolesAndGrants(@Param('codiceUtente') codiceUtente: number, @Res() res: Response) {
        try {
            const menus = await this.permissionService.getUserRolesAndGrants(codiceUtente);
            return RestUtilities.sendBaseResponse(res, menus);
        } catch (error) {
            return RestUtilities.sendErrorMessage(res, error, PermissionController.name);
        }
    }

}
