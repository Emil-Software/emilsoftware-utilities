import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Inject,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { join } from 'path';
import { Logger } from '../../Logger';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { GetUsersResponse } from '../Dtos/GetUsersResponse';
import { RegisterRequest } from '../Dtos/RegisterRequest';
import { RegisterResponse } from '../Dtos/RegisterResponse';
import { SetStatoRegistrazioneDto } from '../Dtos/SetStatoRegistrazione';
import { UserDto } from '../Dtos/UserDto';
import { EmailService } from '../Services/EmailService/EmailService';
import { UserService } from '../Services/UserService/UserService';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import {
  checkPublicAuthRateLimit,
  sendPublicAuthRateLimitExceeded,
} from '../security/publicAuthRateLimit';
import {
  ensureSelfOrSuperUser,
  ensureSuperUser,
  getAuthenticatedAccessiUser,
  hasPrivilegedUserChanges,
} from '../security/accessControl';

@ApiTags('User')
@Controller('accessi/user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
  ) {}

  private sendControllerError(res: Response, error: unknown) {
    const status =
      error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    return RestUtilities.sendErrorMessage(res, error, UserController.name, status);
  }

  @ApiOperation({
    summary: 'Serve la pagina di reset password',
    operationId: 'serveResetPasswordPageUser',
  })
  @ApiParam({
    name: 'token',
    description: 'Token per il reset della password',
    required: true,
  })
  @Get('reset-password/:token')
  async serveResetPasswordPage(@Res() res: Response, @Param('token') token: string) {
    return res.sendFile(join(__dirname, '..', 'Views', 'reset-password.html'));
  }

  @ApiOperation({
    summary: 'Recupera la lista degli utenti',
    operationId: 'getUsers',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista utenti recuperata con successo',
    type: GetUsersResponse,
  })
  @ApiResponse({ status: 401, description: 'Credenziali non valide' })
  @ApiQuery({
    name: 'email',
    required: false,
    description: "Email dell'utente da cercare",
  })
  @ApiQuery({
    name: 'codiceUtente',
    required: false,
    description: "Codice dell'utente da cercare",
  })
  @ApiQuery({
    name: 'includeExtensionFields',
    required: false,
    description: 'Includi extension fields',
  })
  @ApiQuery({
    name: 'includeGrants',
    required: false,
    description: 'Includi permessi',
  })
  @ApiBearerAuth()
  @UseGuards(JwtSimpleGuard)
  @Get('get-users')
  async getUsers(
    @Req() request: Request,
    @Res() res: Response,
    @Query('email') email?: string,
    @Query('codiceUtente') codiceUtente?: number,
    @Query('includeExtensionFields', new ParseBoolPipe({ optional: true }))
    includeExtensionFields?: boolean,
    @Query('includeGrants', new ParseBoolPipe({ optional: true }))
    includeGrants?: boolean,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono consultare gli utenti.',
      );

      const filters = { email, codiceUtente };
      const options = {
        includeExtensionFields: includeExtensionFields ?? true,
        includeGrants: includeGrants ?? true,
      };

      const users = await this.userService.getUsers(filters, options);
      return RestUtilities.sendBaseResponse(res, users);
    } catch (error) {
      this.logger.error('Errore durante il recupero degli utenti: ', error);
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Elimina un utente',
    operationId: 'deleteUser',
    description: 'Imposta lo stato di un utente a eliminato senza rimuovere i record.',
  })
  @ApiParam({
    name: 'codiceUtente',
    description: "Codice identificativo dell'utente da eliminare",
    required: true,
    example: '123',
  })
  @ApiResponse({ status: 200, description: 'Utente eliminato con successo' })
  @ApiResponse({
    status: 400,
    description: 'Errore nei parametri della richiesta',
  })
  @ApiResponse({ status: 500, description: 'Errore interno del server' })
  @ApiBearerAuth()
  @UseGuards(JwtSimpleGuard)
  @Delete('delete-user/:codiceUtente')
  async deleteUser(
    @Req() request: Request,
    @Param('codiceUtente', ParseIntPipe) codiceUtente: number,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono eliminare utenti.',
      );

      await this.userService.deleteUser(codiceUtente);
      return RestUtilities.sendOKMessage(res, "L'utente e' stato eliminato con successo.");
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Imposta lo stato di registrazione di un utente',
    operationId: 'setStatoRegistrazione',
  })
  @ApiResponse({
    status: 200,
    description: 'Stato registrazione aggiornato con successo',
  })
  @ApiResponse({
    status: 400,
    description: 'Errore nei parametri della richiesta',
  })
  @ApiResponse({
    status: 500,
    description: 'Errore interno del server',
  })
  @ApiBody({ type: SetStatoRegistrazioneDto })
  @ApiBearerAuth()
  @UseGuards(JwtSimpleGuard)
  @Post('set-stato')
  async setStatoRegistrazione(
    @Req() request: Request,
    @Body() body: SetStatoRegistrazioneDto,
    @Res() res: Response,
  ) {
    try {
      ensureSuperUser(
        getAuthenticatedAccessiUser(request),
        'Solo gli amministratori possono modificare lo stato di registrazione.',
      );

      const { codiceUtente, statoRegistrazione } = body;
      if (!codiceUtente) throw new Error('Il codice utente e\' obbligatorio.');
      if (statoRegistrazione === undefined) {
        throw new Error('Lo stato registrazione e\' obbligatorio.');
      }

      await this.userService.setStato(codiceUtente, statoRegistrazione);
      return RestUtilities.sendOKMessage(
        res,
        `Lo stato dell'utente ${codiceUtente} e' stato aggiornato a ${statoRegistrazione}.`,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Registra un nuovo utente',
    operationId: 'register',
  })
  @ApiBody({
    type: RegisterRequest,
    description: "Dati necessari per la registrazione dell'utente",
  })
  @ApiCreatedResponse({
    description:
      'Utente registrato con successo. Restituisce il codice utente e invia una mail di reset password.',
    type: RegisterResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Errore nella registrazione.',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Errore interno del server durante la registrazione o l\'invio email.',
  })
  @Post('register')
  async register(
    @Req() request: Request,
    @Body() registrationData: RegisterRequest,
    @Res() res: Response,
  ) {
    try {
      const rateLimitDecision = checkPublicAuthRateLimit(
        this.accessiOptions,
        'register',
        request,
        [registrationData?.email],
      );
      if (!rateLimitDecision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, rateLimitDecision.retryAfterSeconds);
      }

      const codiceUtente = await this.userService.register(registrationData, {
        allowPrivilegedFields: false,
      });

      await this.emailService.sendPasswordResetEmail(registrationData.email);
      return RestUtilities.sendBaseResponse(res, codiceUtente);
    } catch (error) {
      const status =
        error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
      return RestUtilities.sendErrorMessage(res, error, UserController.name, status);
    }
  }

  @ApiOperation({
    summary: 'Aggiorna un utente esistente',
    operationId: 'updateUtente',
  })
  @ApiParam({
    name: 'codiceUtente',
    description: "Codice identificativo dell'utente da aggiornare",
    required: true,
    example: '123',
  })
  @ApiBody({
    type: UserDto,
    description: "Dati aggiornati dell'utente",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Utente aggiornato con successo',
  })
  @ApiResponse({ status: 400, description: "Errore nell'aggiornamento" })
  @ApiBearerAuth()
  @UseGuards(JwtSimpleGuard)
  @Put('update-user/:codiceUtente')
  async updateUtente(
    @Req() request: Request,
    @Param('codiceUtente', ParseIntPipe) codiceUtente: number,
    @Body() user: UserDto,
    @Res() res: Response,
  ) {
    try {
      const authenticatedUser = getAuthenticatedAccessiUser(request);
      const isPrivilegedUpdate = hasPrivilegedUserChanges(user);

      if (isPrivilegedUpdate) {
        ensureSuperUser(
          authenticatedUser,
          'Solo gli amministratori possono modificare ruoli, permessi o flag privilegiati.',
        );
      } else {
        ensureSelfOrSuperUser(
          authenticatedUser,
          codiceUtente,
          'Puoi modificare solo il tuo profilo.',
        );
      }

      if (user.codiceUtente !== undefined && user.codiceUtente !== codiceUtente) {
        throw new Error('Il codice utente nel body non coincide con quello del path.');
      }

      await this.userService.updateUser(codiceUtente, user, {
        allowPrivilegedChanges: authenticatedUser.flagSuper,
      });

      return RestUtilities.sendOKMessage(
        res,
        `L'utente ${codiceUtente} e' stato aggiornato con successo.`,
      );
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }

  @ApiOperation({
    summary: 'Imposta il consenso GDPR per un utente',
    operationId: 'setGdpr',
  })
  @ApiParam({
    name: 'codiceUtente',
    description: "Codice identificativo dell'utente che accetta il GDPR",
    required: true,
    example: '123',
  })
  @ApiResponse({
    status: 200,
    description: 'Consenso GDPR impostato con successo',
  })
  @ApiResponse({ status: 400, description: 'Errore nella richiesta' })
  @ApiBearerAuth()
  @UseGuards(JwtSimpleGuard)
  @Patch('set-gdpr/:codiceUtente')
  async setGdpr(
    @Req() request: Request,
    @Param('codiceUtente', ParseIntPipe) codiceUtente: number,
    @Res() res: Response,
  ) {
    try {
      ensureSelfOrSuperUser(
        getAuthenticatedAccessiUser(request),
        codiceUtente,
        'Puoi impostare il GDPR solo sul tuo utente.',
      );

      await this.userService.setGdpr(codiceUtente);
      return RestUtilities.sendOKMessage(res, `L'utente ${codiceUtente} ha accettato il GDPR.`);
    } catch (error) {
      return this.sendControllerError(res, error);
    }
  }
}
