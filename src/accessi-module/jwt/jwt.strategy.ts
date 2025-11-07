import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AccessiOptions } from '../AccessiModule';

@Injectable()
export class JwtSimpleGuard implements CanActivate {
  constructor(@Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers['authorization'];
    if (!authHeader) throw new UnauthorizedException('Token mancante.');

    const token = authHeader.split(' ')[1];
    if (!token) throw new UnauthorizedException('Formato token non valido.');

    try {
      const secret =
        this.accessiOptions?.jwtOptions?.secret || process.env.ACC_JWT_SECRET || 'super-secret';
      const payload = jwt.verify(token, secret);
      request.user = payload;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Token non valido o scaduto.');
    }
  }
}
