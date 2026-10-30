import { Controller, Get, Module, Res } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Response } from 'express';
import type { AccessiOptions } from '../AccessiModule';
import {
  checkAccessiReadiness,
  createAccessiLiveReport,
  readinessHttpStatus,
} from './readiness';
import type {
  AccessiLiveReport,
  AccessiReadinessCheck,
  AccessiReadinessDependencies,
  AccessiReadinessReport,
} from './readiness';

export interface AccessiHealthModuleOptions {
  /** Opzioni gia passate ad `AccessiModule.forRoot` / `initializeAccessiModule`. */
  accessiOptions: AccessiOptions;
  /** Check applicativi aggiuntivi, come nel servizio standalone. */
  readinessChecks?: AccessiReadinessCheck[];
  /** Override dei check (es. pool database esterni o test). */
  readinessDependencies?: AccessiReadinessDependencies;
  /** Path base degli endpoint. Default: `/health`. */
  path?: string;
}

function normalizeHealthPath(value: string): string {
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

@Module({})
class AccessiHealthHostModule {}

/**
 * Crea un modulo Nest con `/health/live` e `/health/ready`.
 *
 * Stesso contratto del servizio standalone: readiness 200/503 con il dettaglio
 * di bootstrap, database, store condivisi e check applicativi. Da importare
 * nell'host Nest accanto ad `AccessiModule.forRoot`:
 *
 * ```ts
 * @Module({
 *   imports: [
 *     AccessiModule.forRoot(accessiOptions),
 *     createAccessiHealthModule({ accessiOptions }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export function createAccessiHealthModule(options: AccessiHealthModuleOptions): DynamicModule {
  const readinessChecks = options.readinessChecks ?? [];
  const basePath = normalizeHealthPath(options.path ?? '/health');

  @Controller(basePath)
  class AccessiHealthController {
    @Get('live')
    live(): AccessiLiveReport {
      return createAccessiLiveReport();
    }

    @Get('ready')
    async ready(@Res({ passthrough: true }) res: Response): Promise<AccessiReadinessReport> {
      const report = await checkAccessiReadiness(
        options.accessiOptions,
        readinessChecks,
        options.readinessDependencies,
      );
      res.status(readinessHttpStatus(report));
      return report;
    }
  }

  return {
    module: AccessiHealthHostModule,
    controllers: [AccessiHealthController],
  };
}
