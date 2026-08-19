import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { join } from 'path';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions } from '../AccessiModule';
import { EmailService } from '../Services/EmailService/EmailService';
import {
  checkPublicAuthRateLimit,
  sendPublicAuthRateLimitExceeded,
} from '../security/publicAuthRateLimit';

@ApiTags('Email')
@Controller('accessi/email')
export class EmailController {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,
    private readonly emailService: EmailService,
  ) {}

  @ApiOperation({
    summary: 'Serve una pagina per il reset della password',
    operationId: 'serveResetPasswordPage',
  })
  @ApiParam({ name: 'token', description: 'Token per il reset della password', required: true })
  @ApiQuery({
    name: 'returnUrl',
    description: 'Url di ritorno della pagina',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Pagina di reset password servita con successo' })
  @Get('reset-password-page/:token')
  async serveResetPasswordPage(
    @Res() res: Response,
    @Param('token') token: string,
    @Query('returnUrl') returnUrl?: string,
  ) {
    return res.sendFile(join(__dirname, '..', 'Views', 'reset-password.html'));
  }

  @ApiOperation({
    summary: 'Invia una e-mail per il reset della password',
    operationId: 'sendPasswordResetEmail',
  })
  @ApiBody({
    schema: {
      properties: {
        email: {
          type: 'string',
          description: "L'email dell'utente che richiede il reset",
        },
      },
      required: ['email'],
    },
  })
  @ApiResponse({ status: 200, description: "L'email di reset e stata gestita con successo" })
  @ApiResponse({
    status: 500,
    description: "Errore interno durante l'invio dell'email",
  })
  @Post('send-reset-password-email')
  async sendPasswordResetEmail(
    @Req() request: Request,
    @Body()
    sendResetPasswordData: {
      email: string;
      htmlMail?: string;
    },
    @Res() res: Response,
  ) {
    try {
      const rateLimitDecision = checkPublicAuthRateLimit(
        this.accessiOptions,
        'passwordResetEmail',
        request,
        [sendResetPasswordData?.email],
      );
      if (!rateLimitDecision.allowed) {
        return sendPublicAuthRateLimitExceeded(res, rateLimitDecision.retryAfterSeconds);
      }

      await this.emailService.sendPasswordResetEmail(sendResetPasswordData.email);
      return RestUtilities.sendOKMessage(
        res,
        "Se l'account esiste, l'email di reset e stata inoltrata al destinatario.",
      );
    } catch (error) {
      return RestUtilities.sendErrorMessage(res, error, EmailController.name);
    }
  }
}
