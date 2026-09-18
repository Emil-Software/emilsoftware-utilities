import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { AllegatiOptions } from "../AllegatiModule";

/**
 * Guard opt-in per i controller Allegati.
 *
 * Senza `authorize` configurato nelle `AllegatiOptions` il guard e un no-op, cosi da
 * preservare la retrocompatibilita. Quando configurato, delega la decisione
 * all'applicazione host (tipicamente il controllo di autenticazione/ownership).
 */
@Injectable()
export class AllegatiAuthorizationGuard implements CanActivate {
    constructor(@Inject('ALLEGATI_OPTIONS') private readonly options: AllegatiOptions) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const authorize = this.options?.authorize;
        if (!authorize) {
            return true;
        }

        const request = context.switchToHttp().getRequest<Request>();
        const allowed = await authorize(request);
        if (!allowed) {
            throw new ForbiddenException({
                code: 'ALLEGATI_FORBIDDEN',
                message: 'Operazione non autorizzata.',
            });
        }

        return true;
    }
}
