import { Body, Controller, HttpException, HttpStatus, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ResendTwoFactorRequest, VerifyTwoFactorRequest } from '../Dtos/TwoFactorDtos';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
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
import { AuthService, PASSWORD_LOGIN_DISABLED } from '../Services/AuthService/AuthService';
import {
  checkPublicAuthRateLimit,
  sendPublicAuthRateLimitExceeded,
} from '../security/publicAuthRateLimit';

@ApiTags('Auth')
@Controller('accessi/auth')
/**
 * Endpoint pubblici di autenticazione locale e verifica sessione.
 * Il login SSO non riceve token esterni qui: il backend validante usa `FederatedAuthService.authenticate`.
 */
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
      const userData = (authenticatedPayload as { utente?: unknown })?.utente;
      if (!userData) {
        throw new Error('Il token non contiene un utente Accessi valido.');
      }

      // Keep the runtime response aligned with GetUserByTokenResponse and Orval:
      // Result.userData contains the authenticated user directly, not a nested JWT payload.
      return RestUtilities.sendBaseResponse(res, { userData });
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, HttpStatus.UNAUTHORIZED);
    }
  }

  @ApiOperation({
    summary: 'Effettua il login utente',
    description:
      "Con sola email restituisce passwordRequired oppure avvia il codice per utenti passwordless. Con password valida restituisce il login completo o challenge se la 2FA e attiva. Nessun JWT viene emesso prima della verifica del codice.",
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
  @ApiResponse({ status: 403, description: 'Utente abilitato solo a SSO.', type: ErrorResponse })
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

      if (!userData.challenge && !userData.passwordRequired) userData.token = this.authService.createAccessiToken(userData.utente, ['password']);

      return RestUtilities.sendBaseResponse(res, userData);
    } catch (error) {
      if ((error as Error)?.message === 'PASSWORD_EXPIRED') {
        this.logger.warning('Password scaduta, cambiare password ', error);
        return RestUtilities.sendPasswordExpired(res);
      }

      if (error instanceof HttpException) {
        return RestUtilities.sendErrorMessage(res, error, AuthController.name, error.getStatus());
      }

      if ((error as Error)?.message === PASSWORD_LOGIN_DISABLED) {
        return res.status(HttpStatus.FORBIDDEN).json({
          severity: 'error', status: HttpStatus.FORBIDDEN, statusCode: 2,
          code: PASSWORD_LOGIN_DISABLED,
          error: PASSWORD_LOGIN_DISABLED,
          message: 'Questo utente e abilitato solo tramite SSO. Accedi con un provider collegato.',
        });
      }

      this.logger.error('Errore durante il login', error);
      if (RestUtilities.isDatabaseSchemaError(error)) {
        return RestUtilities.sendErrorMessage(
          res,
          error,
          AuthController.name,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return RestUtilities.sendInvalidCredentials(res);
    }
  }

  @Post('two-factor/verify')
  @ApiOperation({ summary: 'Verifica il codice e completa il login', operationId: 'verifyTwoFactor' })
  @ApiBody({ type: VerifyTwoFactorRequest })
  @ApiResponse({ status: 200, type: LoginResponse })
  @ApiResponse({ status: 401, type: ErrorResponse })
  @ApiResponse({ status: 429, type: ErrorResponse })
  async verifyTwoFactor(@Req() request: Request, @Body() body: VerifyTwoFactorRequest, @Res() res: Response) {
    try {
      const limit = checkPublicAuthRateLimit(this.options, 'twoFactorVerify', request, [body.challengeId]);
      if (!limit.allowed) return sendPublicAuthRateLimitExceeded(res, limit.retryAfterSeconds);
      return RestUtilities.sendBaseResponse(res, await this.authService.verifyTwoFactor(body.challengeId, body.code));
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, error instanceof HttpException ? error.getStatus() : 500);
    }
  }

  @Post('two-factor/resend')
  @ApiOperation({ summary: 'Reinvia il codice, invalidando il precedente', operationId: 'resendTwoFactor' })
  @ApiBody({ type: ResendTwoFactorRequest })
  @ApiResponse({ status: 200, type: LoginResponse })
  @ApiResponse({ status: 401, type: ErrorResponse })
  @ApiResponse({ status: 429, type: ErrorResponse })
  async resendTwoFactor(@Req() request: Request, @Body() body: ResendTwoFactorRequest, @Res() res: Response) {
    try {
      const limit = checkPublicAuthRateLimit(this.options, 'twoFactorResend', request, [body.challengeId]);
      if (!limit.allowed) return sendPublicAuthRateLimitExceeded(res, limit.retryAfterSeconds);
      return RestUtilities.sendBaseResponse(res, await this.authService.resendTwoFactor(body.challengeId));
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, error instanceof HttpException ? error.getStatus() : 500);
    }
  }
}
