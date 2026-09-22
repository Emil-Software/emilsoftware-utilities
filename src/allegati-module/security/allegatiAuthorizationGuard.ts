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
        // Opt-out esplicito: ripristina il comportamento storico (endpoint aperti).
        if (this.options?.requireAuthorization === false) {
            return true;
        }

        const authorize = this.options?.authorize;
        if (!authorize) {
            // Secure by default: senza un controllo configurato l'accesso e negato.
            throw new ForbiddenException({
                code: 'ALLEGATI_AUTHORIZATION_NOT_CONFIGURED',
                message: 'Allegati: nessun controllo di autorizzazione configurato. Definire allegatiOptions.authorize oppure impostare requireAuthorization: false per il comportamento storico.',
            });
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
