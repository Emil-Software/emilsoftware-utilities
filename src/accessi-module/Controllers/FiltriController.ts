import { Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { FiltriUtente, GetFiltriUtenteRequest, GetFiltriUtenteResponse } from '../Dtos';
import { GetFiltriResponse } from '../Dtos/TipoFiltro';
import { FiltriService } from '../Services/FiltriService/FiltriService';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import {
  ensureSelfOrSuperUser,
  ensureSuperUser,
  getAuthenticatedAccessiUser,
} from '../security/accessControl';

@ApiTags('Filtri')
@ApiBearerAuth()
@Controller('accessi/filtri')
@UseGuards(JwtSimpleGuard)
export class FiltriController {
  constructor(
    private readonly filtriService: FiltriService,
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
  ) {}

  @Get('tipi')
  @ApiOperation({
    operationId: 'getTipiFiltro',
    summary: 'Recupera la lista dei tipi di filtri',
    description: 'Ritorna tutti i tipi di filtri disponibili nel sistema',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista dei tipi di filtri recuperata con successo',
    type: GetFiltriResponse,
  })
  @ApiResponse({
    status: 500,
    description: 'Errore interno durante il recupero dei tipi di filtri',
  })
  async getTipoFiltri(@Res() res: Response) {
    try {
      const response = await this.filtriService.getTipoFiltri();
      return RestUtilities.sendBaseResponse(res, response);
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FiltriController.name);
    }
  }

  @Get('utente')
  @ApiOperation({
    operationId: 'getFiltriUtente',
    summary: 'Recupera i filtri di un utente',
    description: 'Ritorna tutti i filtri associati ad un utente specifico',
  })
  @ApiResponse({
    status: 200,
    description: "Lista dei filtri dell'utente recuperata con successo",
    type: GetFiltriUtenteResponse,
  })
  async getFiltriUtente(
    @Req() request: Request,
    @Res() res: Response,
    @Query() req: GetFiltriUtenteRequest,
  ) {
    try {
      const authenticatedUser = getAuthenticatedAccessiUser(request);
      const targetUserCode = req?.codUte;

      if (targetUserCode === undefined) {
        ensureSuperUser(
          authenticatedUser,
          'Solo gli amministratori possono consultare i filtri di tutti gli utenti.',
        );
      } else {
        ensureSelfOrSuperUser(
          authenticatedUser,
          Number(targetUserCode),
          'Puoi consultare solo i tuoi filtri.',
        );
      }

      const response = await this.filtriService.getFiltriUser(targetUserCode);
      return RestUtilities.sendBaseResponse(res, response);
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FiltriController.name);
    }
  }

  @Post('utente')
  @ApiOperation({
    operationId: 'saveFiltriUtente',
    summary: 'Inserisce o aggiorna i filtri di un utente',
    description: 'Permette di salvare i filtri associati ad un utente specifico',
  })
  @ApiResponse({
    status: 200,
    description: 'Filtri utente salvati con successo',
  })
  @ApiResponse({
    status: 500,
    description: 'Errore interno durante il salvataggio dei filtri utente',
  })
  async saveFiltriUtente(
    @Req() request: Request,
    @Res() res: Response,
    @Body() req: FiltriUtente,
  ) {
    try {
      const authenticatedUser = getAuthenticatedAccessiUser(request);
      const targetUserCode = req?.codUte ?? authenticatedUser.codiceUtente;

      ensureSelfOrSuperUser(
        authenticatedUser,
        Number(targetUserCode),
        'Puoi modificare solo i tuoi filtri.',
      );

      await this.filtriService.upsertFiltriUtente(targetUserCode, {
        ...req,
        codUte: targetUserCode,
      });
      return RestUtilities.sendOKMessage(
        res,
        `Aggiornamento filtri per l'utente ${targetUserCode} effettuato correttamente`,
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FiltriController.name);
    }
  }
}
