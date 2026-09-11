import { Inject, Injectable } from '@nestjs/common';
import { autobind } from '../../../autobind';
import type { AccessiOptions } from '../../AccessiModule';
import { Orm } from '../../../Orm';

@autobind
@Injectable()
/** Administrative catalog service. Disabling a menu or group does not delete grants already stored for it. */
export class ConfiguratorService {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,

  ) {}

  /** Enables or disables one menu in the runtime catalog. Disabled menus are excluded from normal grant resolution. */
  public async setMenuEnabled(codiceMenu: string, enabled: boolean): Promise<void> {
    const query = `UPDATE MENU SET FLGENABLED = ? WHERE CODMNU = ?`;
    const enabledValue = enabled ? 1 : 0
    await Orm.execute(this.accessiOptions.databaseOptions, query, [enabledValue,codiceMenu])
  }

  /** Enables or disables a whole group. Existing menus and role mappings are preserved for future reactivation. */
  public async setGroupEnabled(codiceGruppo: string, enabled: boolean): Promise<void> {
    const query = `UPDATE MENU_GRP SET FLGENABLED = ? WHERE CODGRP = ?`
    const enabledValue = enabled ? 1 : 0
    await Orm.execute(this.accessiOptions.databaseOptions, query, [enabledValue, codiceGruppo])
  }




}
