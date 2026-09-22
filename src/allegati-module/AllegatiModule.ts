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
     * Guard opzionale applicato a ogni richiesta dei controller Allegati.
     * Se definito e restituisce `false`, la richiesta viene rifiutata con 403.
     * Se non definito, il comportamento storico resta invariato (nessun controllo).
     */
    authorize?: (request: Request) => boolean | Promise<boolean>;
}

@Global()
@Module({
    controllers: [AllegatiController],
    providers: [AllegatiService, AllegatiAuthorizationGuard],
    exports: [AllegatiService],
})
export class AllegatiModule {

    static forRoot(options: AllegatiOptions): DynamicModule {
        if (!options?.authorize) {
            new Logger(AllegatiModule.name).warning(
                'Allegati configurato senza authorize: gli endpoint restano accessibili senza controllo di autorizzazione. Configurare allegatiOptions.authorize in produzione.',
            );
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
