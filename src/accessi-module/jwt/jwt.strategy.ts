import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AccessiOptions } from '../AccessiModule';
import { UserService } from '../Services/UserService/UserService';
import {
  buildAuthenticatedTokenPayload,
  extractAccessiBearerToken,
  isAuthenticatedUserEnabledForJwt,
  isAccessiTokenAllowedForUser,
  resolveCodiceUtenteFromTokenPayload,
} from '../security/authenticatedToken';

@Injectable()
export class JwtSimpleGuard implements CanActivate {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,
    private readonly userService: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers['authorization'];
    if (!authHeader) throw new UnauthorizedException('Token mancante.');

    const token = extractAccessiBearerToken(authHeader);
    if (!token) throw new UnauthorizedException('Formato token non valido.');

    try {
      const secret = this.accessiOptions?.jwtOptions?.secret || process.env.ACC_JWT_SECRET;
      if (!secret) {
        throw new InternalServerErrorException('JWT secret non configurato.');
      }
      let payload: jwt.JwtPayload | string;
      try {
        payload = jwt.verify(token, secret);
      } catch {
        throw new UnauthorizedException('Token non valido o scaduto.');
      }
      const codiceUtente = resolveCodiceUtenteFromTokenPayload(payload);
      if (!codiceUtente) {
        throw new UnauthorizedException('Token privo di un utente valido.');
      }

      const currentUser = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
      if (!isAuthenticatedUserEnabledForJwt(currentUser) || !isAccessiTokenAllowedForUser(payload, currentUser)) {
        throw new UnauthorizedException('Utente non piu autorizzato.');
      }

      request.user = buildAuthenticatedTokenPayload(payload, currentUser);
      return true;
    } catch (error) {
      if (error instanceof InternalServerErrorException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new InternalServerErrorException('Errore durante la verifica dell utente.');
    }
  }
}
