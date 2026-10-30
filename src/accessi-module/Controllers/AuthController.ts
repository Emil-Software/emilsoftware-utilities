import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ResendTwoFactorRequest, VerifyTwoFactorRequest } from '../Dtos/TwoFactorDtos';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Logger } from '../../Logger';
import { RestUtilities } from '../../Utilities';
import type { AccessiOptions } from '../AccessiModule';
import {
  ActionResponse,
  AdminBootstrapStatusResponse,
  BootstrapAdminRequest,
  BootstrapAdminResponse,
  ConfirmResetPasswordRequest,
  ErrorResponse,
  GetUserByTokenRequest,
  GetUserByTokenResponse,
  LoginRequest,
  LoginResponse,
  PasswordExpiredResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  RevokeTokenRequest,
} from '../Dtos';
import { AuthService, PASSWORD_LOGIN_DISABLED } from '../Services/AuthService/AuthService';
import { AdminBootstrapService } from '../Services/AdminBootstrapService/AdminBootstrapService';
import { JwtSimpleGuard } from '../jwt/jwt.strategy';
import { getAuthenticatedAccessiUser } from '../security/accessControl';
import {
  getSessionRevocationStore,
  revokeAccessiUserSessions,
} from '../security/sessionRevocation';
import {
  getAccessTokenRevocationStore,
  revokeAccessiAccessToken,
} from '../security/accessTokenRevocation';
import { auditAccessi } from '../security/audit';
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
    private readonly adminBootstrapService: AdminBootstrapService,
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
      const rateLimitDecision = await checkPublicAuthRateLimit(
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
      const rateLimitDecision = await checkPublicAuthRateLimit(
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
    summary: 'Revoca tutte le sessioni dell utente corrente',
    operationId: 'revokeSessions',
    description:
      'Invalida i token emessi prima di questa chiamata. Richiede sessionRevocation.store configurato. I token emessi dopo la revoca restano validi.',
  })
  @ApiOkResponse({ type: ActionResponse })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'Token Accessi mancante o non valido.' })
  @ApiResponse({ status: 501, type: ErrorResponse, description: 'Revoca sessioni non configurata.' })
  @UseGuards(JwtSimpleGuard)
  @Post('revoke-sessions')
  async revokeSessions(@Req() request: Request, @Res() res: Response) {
    try {
      const user = getAuthenticatedAccessiUser(request);
      if (!getSessionRevocationStore(this.options)) {
        throw new HttpException(
          {
            code: 'ACCESSI_SESSION_REVOCATION_DISABLED',
            message: 'La revoca sessioni non e configurata su questa istanza.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        );
      }
      await revokeAccessiUserSessions(this.options, user.codiceUtente);
      return RestUtilities.sendOKMessage(res, 'Sessioni revocate con successo.');
    } catch (error) {
      return RestUtilities.sendErrorMessage(
        res,
        error,
        AuthController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({
    summary: 'Revoca un singolo access token tramite jti',
    operationId: 'revokeToken',
    description:
      'Annulla un solo token (logout del dispositivo corrente o token compromesso) senza toccare le altre sessioni. ' +
      'Se il body non contiene jti viene revocato il token della richiesta. Richiede accessTokenRevocation.store configurato.',
  })
  @ApiBody({ type: RevokeTokenRequest })
  @ApiOkResponse({ type: ActionResponse })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'Token Accessi mancante o non valido.' })
  @ApiResponse({ status: 403, type: ErrorResponse, description: 'Non autorizzato a revocare il token indicato.' })
  @ApiResponse({ status: 501, type: ErrorResponse, description: 'Revoca token non configurata.' })
  @UseGuards(JwtSimpleGuard)
  @Post('revoke-token')
  async revokeToken(
    @Req() request: Request,
    @Body() body: RevokeTokenRequest,
    @Res() res: Response,
  ) {
    try {
      const user = getAuthenticatedAccessiUser(request);
      if (!getAccessTokenRevocationStore(this.options)) {
        throw new HttpException(
          {
            code: 'ACCESSI_ACCESS_TOKEN_REVOCATION_DISABLED',
            message: 'La revoca dei singoli token non e configurata su questa istanza.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        );
      }

      const payload = ((request as Request & { user?: unknown }).user ?? {}) as Record<string, unknown>;
      const currentJti = typeof payload.jti === 'string' ? payload.jti : undefined;
      const requestedJti = typeof body?.jti === 'string' ? body.jti.trim() : '';
      const targetJti = requestedJti !== '' ? requestedJti : currentJti;

      if (!targetJti) {
        throw new HttpException(
          { code: 'ACCESSI_TOKEN_JTI_MISSING', message: 'Il token non contiene un jti revocabile.' },
          HttpStatus.BAD_REQUEST,
        );
      }

      const isCurrentToken = targetJti === currentJti;
      if (!isCurrentToken && !user.flagAdmin && !user.flagSuper) {
        throw new HttpException(
          {
            code: 'ACCESSI_TOKEN_REVOKE_FORBIDDEN',
            message: 'Solo gli amministratori possono revocare il token di un altro utente.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      const expiresAt = Number(payload.exp);
      await revokeAccessiAccessToken(
        this.options,
        targetJti,
        isCurrentToken && Number.isFinite(expiresAt) ? expiresAt * 1000 : undefined,
      );
      auditAccessi('access_token_revoked', {
        codiceUtente: user.codiceUtente,
        actor: user.codiceUtente,
        jti: targetJti,
        self: isCurrentToken,
      });
      return RestUtilities.sendOKMessage(res, 'Token revocato con successo.');
    } catch (error) {
      return RestUtilities.sendErrorMessage(
        res,
        error,
        AuthController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST,
      );
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
      const rateLimitDecision = await checkPublicAuthRateLimit(
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

      if (!userData.challenge && !userData.passwordRequired) {
        const tokens = this.authService.createTokenPair(userData.utente, ['password']);
        userData.token = tokens.access;
        if (tokens.refresh) userData.refreshToken = tokens.refresh;
      }

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

  @ApiOperation({
    summary: 'Scambia un refresh token con un nuovo access token',
    operationId: 'refreshAccessToken',
    description:
      'Richiede jwtOptions.refreshExpiresIn. Il refresh token ha typ=refresh e non e accettato dai guard API.',
  })
  @ApiBody({ type: RefreshTokenRequest })
  @ApiOkResponse({ type: RefreshTokenResponse })
  @ApiResponse({ status: 401, description: 'Refresh token non valido, scaduto o revocato.', type: ErrorResponse })
  @ApiResponse({ status: 429, description: 'Troppi tentativi.', type: ErrorResponse })
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Body() body: RefreshTokenRequest,
    @Res() res: Response,
  ) {
    try {
      const tokenKey = typeof body?.refreshToken === 'string'
        ? createHash('sha256').update(body.refreshToken).digest('hex').slice(0, 32)
        : undefined;
      const decision = await checkPublicAuthRateLimit(
        this.options,
        'refresh',
        request,
        tokenKey ? [tokenKey] : [],
      );
      if (!decision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, decision.retryAfterSeconds);
      }

      const result = await this.authService.refreshAccessToken(body?.refreshToken);
      if (!result.token) {
        throw new HttpException('Refresh token non valido.', HttpStatus.UNAUTHORIZED);
      }
      return RestUtilities.sendBaseResponse(res, {
        token: result.token,
        ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
      });
    } catch (error) {
      return RestUtilities.sendErrorMessage(
        res,
        error,
        AuthController.name,
        error instanceof HttpException ? error.getStatus() : HttpStatus.UNAUTHORIZED,
      );
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
      const limit = await checkPublicAuthRateLimit(this.options, 'twoFactorVerify', request, [body.challengeId]);
      if (!limit.allowed) return sendPublicAuthRateLimitExceeded(res, limit.retryAfterSeconds);
      return RestUtilities.sendBaseResponse(res, await this.authService.verifyTwoFactor(body.challengeId, body.code, body.scope));
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
      const limit = await checkPublicAuthRateLimit(this.options, 'twoFactorResend', request, [body.challengeId]);
      if (!limit.allowed) return sendPublicAuthRateLimitExceeded(res, limit.retryAfterSeconds);
      return RestUtilities.sendBaseResponse(res, await this.authService.resendTwoFactor(body.challengeId));
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, error instanceof HttpException ? error.getStatus() : 500);
    }
  }

  @Post('bootstrap-admin')
  @ApiOperation({
    summary: 'Crea il primo utente admin (bootstrap)',
    operationId: 'bootstrapAdmin',
    description:
      'Endpoint pubblico ma protetto dal token di avvio: attivo solo con adminBootstrap.enabled. ' +
      'Crea un utente in stato confermato senza email, con flag admin (e super opzionale) e password fornita o generata.',
  })
  @ApiBody({ type: BootstrapAdminRequest })
  @ApiResponse({ status: 200, type: BootstrapAdminResponse })
  @ApiResponse({ status: 401, description: 'Token di bootstrap non valido', type: ErrorResponse })
  @ApiResponse({ status: 403, description: 'Bootstrap admin non abilitato', type: ErrorResponse })
  @ApiResponse({ status: 429, description: 'Troppi tentativi', type: ErrorResponse })
  async bootstrapAdmin(@Req() request: Request, @Body() body: BootstrapAdminRequest, @Res() res: Response) {
    try {
      const limit = await checkPublicAuthRateLimit(this.options, 'adminBootstrap', request);
      if (!limit.allowed) return sendPublicAuthRateLimitExceeded(res, limit.retryAfterSeconds);
      return RestUtilities.sendBaseResponse(res, await this.adminBootstrapService.bootstrap(body));
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name, error instanceof HttpException ? error.getStatus() : 500);
    }
  }

  @Get('bootstrap-admin/status')
  @ApiOperation({
    summary: 'Indica se il bootstrap admin e abilitato',
    operationId: 'getAdminBootstrapStatus',
    description:
      'Endpoint pubblico: la console mostra la sezione "Crea utente admin" solo quando enabled e true.',
  })
  @ApiResponse({ status: 200, type: AdminBootstrapStatusResponse })
  async adminBootstrapStatus(@Res() res: Response) {
    return RestUtilities.sendBaseResponse(res, { enabled: this.adminBootstrapService.isEnabled() });
  }
}
