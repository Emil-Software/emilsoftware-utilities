import {
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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { ActionResponse, ErrorResponse } from '../Dtos/BaseResponse';
import {
  CreateFilterTypeRequest,
  FiltriUtente,
  GetFiltriUtenteRequest,
  GetFiltriUtenteResponse,
  UpdateFilterTypeRequest,
} from '../Dtos';
import { GetFiltriResponse } from '../Dtos/TipoFiltro';
import { FiltriService } from '../Services/FiltriService/FiltriService';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import {
  ensureSelfOrSuperUser,
  ensureAdmin,
  getAuthenticatedAccessiUser,
} from '../security/accessControl';

@ApiTags('Filtri')
@ApiBearerAuth()
@Controller('accessi/filtri')
@UseGuards(JwtSimpleGuard)
/** API per lettura e persistenza dei filtri applicativi collegati a un utente Accessi. */
export class FiltriController {
  constructor(
    private readonly filtriService: FiltriService,
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
    type: ErrorResponse,
  })
  async getTipoFiltri(@Res() res: Response) {
    try {
      const response = await this.filtriService.getTipoFiltri();
      return RestUtilities.sendBaseResponse(res, response);
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FiltriController.name);
    }
  }

  @Post('tipi')
  @ApiOperation({
    operationId: 'createTipoFiltro',
    summary: 'Crea un tipo di filtro',
    description: 'Inserisce una nuova voce nel catalogo dei tipi di filtro. Operazione riservata al superutente.',
  })
  @ApiResponse({ status: 201, description: 'Tipo filtro creato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  async createTipoFiltro(
    @Req() request: Request,
    @Res() res: Response,
    @Body() body: CreateFilterTypeRequest,
  ) {
    try {
      ensureAdmin(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono creare tipi filtro.');
      await this.filtriService.createTipoFiltro(body);
      return RestUtilities.sendOKMessage(
        res,
        `Il tipo filtro ${body.tipFil} e' stato creato con successo.`,
        HttpStatus.CREATED,
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FiltriController.name);
    }
  }

  @Put('tipi/:tipFil')
  @ApiOperation({
    operationId: 'updateTipoFiltro',
    summary: 'Aggiorna un tipo di filtro',
    description: 'Aggiorna descrizione, campo o stato di un tipo di filtro esistente.',
  })
  @ApiParam({ name: 'tipFil', description: 'Identificativo del tipo filtro', required: true, example: 1, type: Number })
  @ApiResponse({ status: 200, description: 'Tipo filtro aggiornato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  async updateTipoFiltro(
    @Req() request: Request,
    @Res() res: Response,
    @Param('tipFil', ParseIntPipe) tipFil: number,
    @Body() body: UpdateFilterTypeRequest,
  ) {
    try {
      ensureAdmin(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono modificare tipi filtro.');
      await this.filtriService.updateTipoFiltro(tipFil, body);
      return RestUtilities.sendOKMessage(res, `Il tipo filtro ${tipFil} e' stato aggiornato con successo.`);
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, FiltriController.name);
    }
  }

  @Delete('tipi/:tipFil')
  @ApiOperation({
    operationId: 'deleteTipoFiltro',
    summary: 'Elimina un tipo di filtro',
    description: 'Elimina un tipo di filtro solo se nessun filtro utente lo utilizza.',
  })
  @ApiParam({ name: 'tipFil', description: 'Identificativo del tipo filtro', required: true, example: 1, type: Number })
  @ApiResponse({ status: 200, description: 'Tipo filtro eliminato con successo', type: ActionResponse })
  @ApiResponse({ status: 400, description: 'Dati non validi', type: ErrorResponse })
  @ApiResponse({ status: 500, description: 'Errore interno del server', type: ErrorResponse })
  async deleteTipoFiltro(
    @Req() request: Request,
    @Res() res: Response,
    @Param('tipFil', ParseIntPipe) tipFil: number,
  ) {
    try {
      ensureAdmin(getAuthenticatedAccessiUser(request), 'Solo gli amministratori possono eliminare tipi filtro.');
      await this.filtriService.deleteTipoFiltro(tipFil);
      return RestUtilities.sendOKMessage(res, `Il tipo filtro ${tipFil} e' stato eliminato con successo.`);
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
  @ApiResponse({
    status: 400,
    description: 'Errore nella richiesta.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: 403,
    description: 'Operazione non autorizzata.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: 500,
    description: 'Errore interno del server.',
    type: ErrorResponse,
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
        ensureAdmin(
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
    type: ActionResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Errore di validazione nei dati inviati.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: 403,
    description: 'Operazione non autorizzata.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: 500,
    description: 'Errore interno durante il salvataggio dei filtri utente',
    type: ErrorResponse,
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
