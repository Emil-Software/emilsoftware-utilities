import { DynamicModule, Global, Module } from "@nestjs/common";
import { AllegatiService } from "./Services/AllegatiService/AllegatiService";
import { AllegatiController } from "./Controllers/AllegatiController";
import { Options } from "node-firebird";
import { Logger } from "../Logger";

export interface AllegatiOptions {
    databaseOptions: Options;
}

@Global()
@Module({
    controllers: [AllegatiController],
    providers: [AllegatiService],
    exports: [AllegatiService],
})
export class AllegatiModule {

    static forRoot(options: AllegatiOptions): DynamicModule {
        return {
            module: AllegatiModule,
            providers: [
                {
                    provide: 'ALLEGATI_OPTIONS',
                    useValue: options,
                },
                AllegatiService,
            ],
            exports: ['ALLEGATI_OPTIONS', AllegatiService],
        };
    }
}
