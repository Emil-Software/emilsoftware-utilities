import { Body, Controller, Inject, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { AuthService } from '../Services/AuthService/AuthService';
import { LoginRequest, LoginResponse } from '../Dtos';
import { Logger } from '../../Logger';

@ApiTags('Auth')
@Controller('accessi/auth')
export class AuthController {

  logger: Logger = new Logger(AuthController.name);
  constructor(
    private readonly authService: AuthService,
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions
  ) { }

  @ApiOperation({ summary: 'Conferma il reset della password', operationId: "resetPassword" })
  @ApiParam({ name: 'token', description: 'Token per il reset della password', required: true })
  @ApiBody({ schema: { properties: { newPassword: { type: 'string', description: 'Nuova password da impostare' } } } })
  @ApiResponse({ status: 200, description: 'Password aggiornata con successo' })
  @ApiResponse({ status: 400, description: 'Errore nella richiesta o token non valido' })
  @Post('confirm-reset-password/:token')
  async resetPassword(@Res() res: Response, @Param('token') token: string, @Body("newPassword") newPassword: string) {
    try {
      await this.authService.confirmResetPassword(token, newPassword);
      return RestUtilities.sendOKMessage(res, 'Password aggiornata con successo!');
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name);
    }
  }

  @ApiOperation({ summary: 'Recupera le informazioni utente dal token JWT', operationId: "getUserByToken" })
  @ApiBody({ schema: { properties: { token: { type: 'string', description: 'JWT dell\'utente' } } } })
  @ApiResponse({ status: 200, description: 'Informazioni utente recuperate con successo' })
  @ApiResponse({ status: 401, description: 'Token non valido o scaduto' })
  @Post('get-user-by-token')
  async getUserByToken(@Body('token') token: string, @Res() res: Response) {
    try {
      if (!token) return RestUtilities.sendErrorMessage(res, 'Token non fornito', AuthController.name);
      const decoded = jwt.verify(token, this.options.jwtOptions.secret);
      if (!decoded) return RestUtilities.sendUnauthorized(res);
      return RestUtilities.sendBaseResponse(res, { userData: decoded });
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, AuthController.name);
    }
  }

  @ApiOperation({
    summary: 'Effettua il login utente',
    description: 'Autentica l\'utente con email e password. Restituisce un token JWT e i dati dell\'utente se le credenziali sono corrette.',
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
  })
  @ApiResponse({
    status: 403,
    description: "Password scaduta, è necessatio aggiornarla. ",
    schema: {
      example: {
        message: {
          severity: 'warning',
          statusCode: 2, // o il valore di StatusCode.Warning
          code: 'PASSWORD_EXPIRED',
          message: 'Password scaduta. È necessario aggiornarla.',
        }
      }
    }
  })
  @Post('login')
  async login(@Body() loginRequest: LoginRequest, @Res() res: Response) {
    try {

      const userData = await this.authService.login(loginRequest);
      if (!userData) {
        return RestUtilities.sendInvalidCredentials(res);
      }

      const tokenData = {
        userData,
      }

      userData.token = {
        expiresIn: this.options.jwtOptions.expiresIn,
        value: jwt.sign(tokenData, this.options.jwtOptions.secret, {
          expiresIn: this.options.jwtOptions.expiresIn as any,
        }),
        type: 'Bearer',
      };

      return RestUtilities.sendBaseResponse(res, userData);
    } catch (error) {

      if (error.message === 'PASSWORD_EXPIRED') {
        this.logger.warning('Password scaduta, cambiare password ', error)
        return RestUtilities.sendPasswordExpired(res)
      }

      this.logger.error('Errore durante il login', error);
      return RestUtilities.sendInvalidCredentials(res);
    }
  }
}
