import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Logger } from '../../../Logger';
import type { AccessiOptions } from '../../AccessiModule';
import { StatoRegistrazione } from '../../Dtos/StatoRegistrazione';
import { AuthService } from '../AuthService/AuthService';
import { UserService } from '../UserService/UserService';
import { clearAdminBootstrapToken, isValidAdminBootstrapToken } from '../../security/adminBootstrap';

export interface BootstrapAdminResult {
  codiceUtente: number;
  email: string;
  /** Presente solo quando la password e stata generata dal server. */
  password?: string;
  passwordGenerated: boolean;
}

/**
 * Crea il primo utente admin tramite il token casuale di avvio. Non invia email di conferma:
 * l'utente nasce in stato CONF e con password impostata (fornita o generata). Il token e monouso
 * e valido solo per il processo corrente.
 */
@Injectable()
export class AdminBootstrapService {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  /** Indica se il backend ha abilitato l'area "crea utente admin". */
  isEnabled(): boolean {
    return this.options.adminBootstrap?.enabled === true;
  }

  async bootstrap(request: { token?: string; email?: string; nome?: string; cognome?: string; password?: string; superUser?: boolean }): Promise<BootstrapAdminResult> {
    if (!this.isEnabled()) {
      throw new ForbiddenException({
        code: 'ACCESSI_ADMIN_BOOTSTRAP_DISABLED',
        message: 'Il bootstrap admin non e abilitato in questa istanza Accessi.',
      });
    }

    if (!isValidAdminBootstrapToken(request?.token)) {
      throw new UnauthorizedException({
        code: 'ACCESSI_ADMIN_BOOTSTRAP_TOKEN_INVALID',
        message: 'Token di bootstrap non valido.',
      });
    }

    const email = typeof request?.email === 'string' ? request.email.trim().toLowerCase() : '';
    if (!email) {
      throw new BadRequestException({
        code: 'ACCESSI_ADMIN_BOOTSTRAP_EMAIL_REQUIRED',
        message: "L'email e obbligatoria per creare l'utente admin.",
      });
    }

    const superUser = request?.superUser ?? this.options.adminBootstrap?.superUser !== false;
    const providedPassword = typeof request?.password === 'string' ? request.password : '';
    const password = providedPassword.length > 0 ? providedPassword : this.generatePassword();
    const passwordGenerated = providedPassword.length === 0;

    const codiceUtente = await this.userService.register(
      {
        email,
        nome: request?.nome,
        cognome: request?.cognome,
        flagAdmin: true,
        flagSuper: superUser,
      },
      { allowPrivilegedFields: true, initialState: StatoRegistrazione.CONF },
    );

    await this.authService.setPassword(codiceUtente, password);

    // Monouso: un bootstrap riuscito invalida il token fino al prossimo riavvio.
    clearAdminBootstrapToken();
    this.logger.info(`Utente admin di bootstrap creato: ${email} (codice ${codiceUtente}). Token invalidato.`);

    return {
      codiceUtente,
      email,
      password: passwordGenerated ? password : undefined,
      passwordGenerated,
    };
  }

  private generatePassword(): string {
    return `Aa1!${randomBytes(9).toString('base64url')}`;
  }
}
