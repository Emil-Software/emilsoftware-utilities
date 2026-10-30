import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AccessiOptions } from '../AccessiModule';
import {
  applyAccessiContentSecurityPolicy,
  resolveAccessiSecurityHeaders,
} from '../security/securityHeaders';

/** Serves the framework-free administrative console bundled with Accessi. API authorization remains on each API endpoint. */
@ApiExcludeController()
@Controller('accessi/console')
export class AccessiConsoleController {
  private htmlCache?: { baseUrl: string | undefined; content: string };

  constructor(@Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions) {}

  private indexHtml(): string {
    const baseUrl = this.options.consoleApiBaseUrl?.replace(/\/+$/, '');
    if (this.htmlCache && this.htmlCache.baseUrl === baseUrl) return this.htmlCache.content;

    const marker = baseUrl
      ? `<script nonce="__ACCESSI_CSP_NONCE__">window.__ACCESSI_API_BASE_URL__=${JSON.stringify(baseUrl)};</script>`
      : '';
    const content = readFileSync(join(__dirname, '..', 'Console', 'index.html'), 'utf8')
      .replace('</head>', `${marker}</head>`);
    this.htmlCache = { baseUrl, content };
    return content;
  }

  /** Origini raggiungibili dalla console: l'API puo stare su un dominio diverso. */
  private consoleConnectSrc(): string[] {
    const baseUrl = this.options.consoleApiBaseUrl?.replace(/\/+$/, '');
    if (!baseUrl) return [];
    try {
      const url = new URL(baseUrl);
      return [`${url.protocol}//${url.host}`];
    } catch {
      return [];
    }
  }

  @Get()
  index(@Res() res: Response) {
    const security = resolveAccessiSecurityHeaders(this.options.http?.securityHeaders);
    res.setHeader('Cache-Control', security?.cacheControl || 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', security?.referrerPolicy || 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (security) {
      if (security.frameOptions) res.setHeader('X-Frame-Options', security.frameOptions);
      if (security.permissionsPolicy) res.setHeader('Permissions-Policy', security.permissionsPolicy);
    }

    // Il nonce cambia a ogni risposta: la shell HTML non puo essere cacheata con il valore incorporato.
    const nonce = security?.contentSecurityPolicy ? randomBytes(16).toString('base64') : '';
    if (security) {
      applyAccessiContentSecurityPolicy(res, security, 'console', {
        ...(nonce ? { nonce } : {}),
        connectSrc: this.consoleConnectSrc(),
      });
    }

    const html = this.indexHtml().split('__ACCESSI_CSP_NONCE__').join(nonce);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  /**
   * Percorsi SPA ammessi. Deve restare allineato a `routeSegment` (e ai padri dei
   * sottomenu) in Console/console.ts, altrimenti i deep link restituiscono 404.
   */
  private static readonly allowedViews = new Set([
    'utenti',
    'ruoli-e-grant',
    'menu-e-gruppi',
    'menu-e-gruppi/gruppi',
    'menu-e-gruppi/menu',
    'menu-e-gruppi/tipi-menu',
    'filtri',
    'filtri/utente',
    'filtri/tipi',
    'sso',
    'sso/provider',
    'sso/utenti',
    'token-di-servizio',
    'wiki',
  ]);

  // Le route statiche vanno dichiarate prima di `:view/:sub`, che altrimenti
  // catturerebbe `assets/<file>` e restituirebbe 404 per CSS e bundle.
  @Get('assets/:file')
  asset(@Param('file') file: string, @Res() res: Response) {
    const allowed = new Set(['console.css', 'console.js']);
    if (!allowed.has(file)) return res.status(404).end();
    // Keep the SPA shell, styles and bundle on the same deployed revision.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.sendFile(join(__dirname, '..', 'Console', file));
  }

  /**
   * Serves the SPA shell for the supported console sections, allowing direct
   * navigation, bookmarks and browser back/forward without server-side state.
   */
  @Get(':view')
  section(@Param('view') view: string, @Res() res: Response) {
    if (!AccessiConsoleController.allowedViews.has(view)) return res.status(404).end();
    return this.index(res);
  }

  /** Serves the SPA shell for nested sections (menu, filtri, SSO). */
  @Get(':view/:sub')
  subsection(@Param('view') view: string, @Param('sub') sub: string, @Res() res: Response) {
    if (!AccessiConsoleController.allowedViews.has(`${view}/${sub}`)) return res.status(404).end();
    return this.index(res);
  }
}
