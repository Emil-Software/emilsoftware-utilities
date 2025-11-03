import { Inject, Injectable } from '@nestjs/common';
import { autobind } from '../../../autobind';
import { AccessiOptions } from '../../AccessiModule';
import { Orm } from '../../../Orm';

@autobind
@Injectable()
export class ConfiguratorService {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,

  ) {}

  public async setMenuEnabled(codiceMenu: string, enabled: boolean): Promise<void> {
    const query = `UPDATE MENU SET FLGENABLED = ? WHERE CODMNU = ?`;
    const enabledValue = enabled ? 1 : 0
    await Orm.execute(this.accessiOptions.databaseOptions, query, [enabledValue,codiceMenu])
  }

  public async setGroupEnabled(codiceGruppo: string, enabled: boolean): Promise<void> {
    const query = `UPDATE MENU_GRP SET FLGENABLED = ? WHERE CODGRP = ?`
    const enabledValue = enabled ? 1 : 0
    await Orm.execute(this.accessiOptions.databaseOptions, query, [enabledValue, codiceGruppo])
  }




}
