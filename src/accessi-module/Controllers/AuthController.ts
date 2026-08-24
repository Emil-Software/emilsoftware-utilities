import { Body, Controller, HttpStatus, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { Logger } from '../../Logger';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import {
  ActionResponse,
  ConfirmResetPasswordRequest,
  ErrorResponse,
  GetUserByTokenRequest,
  GetUserByTokenResponse,
  LoginRequest,
  LoginResponse,
  PasswordExpiredResponse,
} from '../Dtos';
import { AuthService } from '../Services/AuthService/AuthService';
import {
  checkPublicAuthRateLimit,
  sendPublicAuthRateLimitExceeded,
} from '../security/publicAuthRateLimit';

@ApiTags('Auth')
@Controller('accessi/auth')
export class AuthController {
  logger: Logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
  ) {}

  @ApiOperation({ summary: 'Conferma il reset della password', operationId: 'resetPassword' })
  @ApiParam({ name: 'token', description: 'Token per il reset della password', required: true })
  @ApiBody({ type: ConfirmResetPasswordRequest })
  @ApiResponse({
    status: 200,
    description: 'Password aggiornata con successo',
    type: ActionResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Errore nella richiesta o token non valido',
    type: ErrorResponse,
  })
  @Post('confirm-reset-password/:token')
  async resetPassword(
    @Req() request: Request,
    @Res() res: Response,
    @Param('token') token: string,
    @Body() body: ConfirmResetPasswordRequest,
  ) {
    try {
      const rateLimitDecision = checkPublicAuthRateLimit(
        this.options,
        'passwordResetConfirm',
        request,
      );
      if (!rateLimitDecision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, rateLimitDecision.retryAfterSeconds);
      }

      await this.authService.confirmResetPassword(token, body.newPassword);
      return RestUtilities.sendOKMessage(res, 'Password aggiornata con successo!');
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({
    summary: 'Recupera le informazioni utente dal token JWT',
    operationId: 'getUserByToken',
  })
  @ApiBody({ type: GetUserByTokenRequest })
  @ApiResponse({
    status: 200,
    description: 'Informazioni utente recuperate con successo',
    type: GetUserByTokenResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Token non valido o scaduto',
    type: ErrorResponse,
  })
  @Post('get-user-by-token')
  async getUserByToken(
    @Req() request: Request,
    @Body() body: GetUserByTokenRequest,
    @Res() res: Response,
  ) {
    try {
      const rateLimitDecision = checkPublicAuthRateLimit(
        this.options,
        'getUserByToken',
        request,
      );
      if (!rateLimitDecision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, rateLimitDecision.retryAfterSeconds);
      }

      if (!body?.token) {
        return RestUtilities.sendErrorMessage(
          res,
          'Token non fornito',
          AuthController.name,
          HttpStatus.BAD_REQUEST,
        );
      }

      const authenticatedPayload = await this.authService.getAuthenticatedTokenPayload(body.token);
      return RestUtilities.sendBaseResponse(res, { userData: authenticatedPayload });
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, HttpStatus.UNAUTHORIZED);
    }
  }

  @ApiOperation({
    summary: 'Effettua il login utente',
    description:
      "Autentica l'utente con email e password. Restituisce un token JWT e i dati dell'utente se le credenziali sono corrette.",
    operationId: 'login',
  })
  @ApiBody({ type: LoginRequest })
  @ApiResponse({
    status: 200,
    description: 'Login effettuato con successo',
    type: LoginResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Credenziali non valide',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: 403,
    description: 'Password scaduta, e necessario aggiornarla.',
    type: PasswordExpiredResponse,
  })
  @Post('login')
  async login(@Req() request: Request, @Body() loginRequest: LoginRequest, @Res() res: Response) {
    try {
      const rateLimitDecision = checkPublicAuthRateLimit(
        this.options,
        'login',
        request,
        [loginRequest?.email],
      );
      if (!rateLimitDecision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, rateLimitDecision.retryAfterSeconds);
      }

      const userData = await this.authService.login(loginRequest);
      if (!userData) {
        return RestUtilities.sendInvalidCredentials(res);
      }

      const tokenData = {
        utente: userData?.utente,
      };

      userData.token = {
        expiresIn: this.options.jwtOptions.expiresIn,
        value: jwt.sign(tokenData, this.options.jwtOptions.secret, {
          expiresIn: this.options.jwtOptions.expiresIn as any,
        }),
        type: 'Bearer',
      };

      return RestUtilities.sendBaseResponse(res, userData);
    } catch (error) {
      if ((error as Error)?.message === 'PASSWORD_EXPIRED') {
        this.logger.warning('Password scaduta, cambiare password ', error);
        return RestUtilities.sendPasswordExpired(res);
      }

      this.logger.error('Errore durante il login', error);
      return RestUtilities.sendInvalidCredentials(res);
    }
  }
}
