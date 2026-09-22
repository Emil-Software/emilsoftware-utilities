import { DynamicModule, Global, Module } from "@nestjs/common";
import { Request } from "express";
import { Options } from "node-firebird";
import { Logger } from "../Logger";
import { AllegatiService } from "./Services/AllegatiService/AllegatiService";
import { AllegatiController } from "./Controllers/AllegatiController";
import { AllegatiAuthorizationGuard } from "./security/allegatiAuthorizationGuard";

export interface AllegatiOptions {
    databaseOptions: Options;
    /**
     * Guard applicato a ogni richiesta dei controller Allegati.
     * Se definito e restituisce `false`, la richiesta viene rifiutata con 403.
     */
    authorize?: (request: Request) => boolean | Promise<boolean>;
    /**
     * Sicurezza by default: se `authorize` non e configurato, le richieste vengono rifiutate con 403.
     * Impostare `false` per ripristinare il comportamento storico (endpoint aperti) durante la migrazione.
     */
    requireAuthorization?: boolean;
}

@Global()
@Module({
    controllers: [AllegatiController],
    providers: [AllegatiService, AllegatiAuthorizationGuard],
    exports: [AllegatiService],
})
export class AllegatiModule {

    static forRoot(options: AllegatiOptions): DynamicModule {
        const logger = new Logger(AllegatiModule.name);
        if (options?.requireAuthorization === false) {
            logger.warning('Allegati con requireAuthorization: false: gli endpoint sono accessibili senza controllo di autorizzazione. Configurare authorize e rimuovere l opt-out.');
        } else if (!options?.authorize) {
            logger.error('Allegati senza authorize: tutte le richieste saranno rifiutate con 403. Configurare allegatiOptions.authorize (oppure requireAuthorization: false per il comportamento storico).');
        }

        return {
            module: AllegatiModule,
            providers: [
                {
                    provide: 'ALLEGATI_OPTIONS',
                    useValue: options,
                },
                AllegatiService,
                AllegatiAuthorizationGuard,
            ],
            exports: ['ALLEGATI_OPTIONS', AllegatiService],
        };
    }
}
