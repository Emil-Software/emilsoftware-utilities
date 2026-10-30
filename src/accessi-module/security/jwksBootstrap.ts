import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { AccessiOptions } from '../AccessiModule';
import { setupAccessiJwks } from './jwks';
import type { AccessiJwksExpressApp } from './jwks';

/**
 * Monta automaticamente la JWKS sull'Express adapter di Nest.
 *
 * Serve sia ai bootstrap standalone sia a `AccessiModule.forRoot` in un'app
 * Nest ospitante, senza richiedere una chiamata manuale a `setupAccessiJwks`.
 */
@Injectable()
export class AccessiJwksBootstrapService implements OnModuleInit {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    const instance: unknown = this.adapterHost.httpAdapter?.getInstance?.();
    if (instance && typeof (instance as AccessiJwksExpressApp).get === 'function') {
      setupAccessiJwks(instance as AccessiJwksExpressApp, this.options);
    }
  }
}
