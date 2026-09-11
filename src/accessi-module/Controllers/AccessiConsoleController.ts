import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { join } from 'path';

/** Serves the framework-free administrative console bundled with Accessi. API authorization remains on each API endpoint. */
@ApiExcludeController()
@Controller('accessi/console')
export class AccessiConsoleController {
  @Get()
  index(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(join(__dirname, '..', 'Console', 'index.html'));
  }

  /**
   * Serves the SPA shell for the supported console sections, allowing direct
   * navigation, bookmarks and browser back/forward without server-side state.
   */
  @Get(':view')
  section(@Param('view') view: string, @Res() res: Response) {
    const allowedViews = new Set(['utenti', 'ruoli-e-grant', 'menu-e-gruppi', 'filtri', 'sso']);
    if (!allowedViews.has(view)) return res.status(404).end();
    return this.index(res);
  }

  @Get('assets/:file')
  asset(@Param('file') file: string, @Res() res: Response) {
    const allowed = new Set(['console.css', 'console.js']);
    if (!allowed.has(file)) return res.status(404).end();
    // Keep the SPA shell, styles and bundle on the same deployed revision.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.sendFile(join(__dirname, '..', 'Console', file));
  }
}
