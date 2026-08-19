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
  isAuthenticatedUserEnabledForJwt,
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

    const token = authHeader.split(' ')[1];
    if (!token) throw new UnauthorizedException('Formato token non valido.');

    try {
      const secret = this.accessiOptions?.jwtOptions?.secret || process.env.ACC_JWT_SECRET;
      if (!secret) {
        throw new InternalServerErrorException('JWT secret non configurato.');
      }
      const payload = jwt.verify(token, secret);
      const codiceUtente = resolveCodiceUtenteFromTokenPayload(payload);
      if (!codiceUtente) {
        throw new UnauthorizedException('Token privo di un utente valido.');
      }

      const currentUser = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
      if (!isAuthenticatedUserEnabledForJwt(currentUser)) {
        throw new UnauthorizedException('Utente non piu autorizzato.');
      }

      request.user = buildAuthenticatedTokenPayload(payload, currentUser);
      return true;
    } catch (error) {
      if (error instanceof InternalServerErrorException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token non valido o scaduto.');
    }
  }
}
