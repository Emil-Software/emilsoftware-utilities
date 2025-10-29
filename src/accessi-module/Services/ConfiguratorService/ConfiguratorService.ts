import { Inject, Injectable } from '@nestjs/common';
import { autobind } from '../../../autobind';
import { AccessiOptions } from '../../AccessiModule';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';

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

  public async getMenuEnabledStatus(codiceMenu: string): Promise<boolean | null> {
    const query = `SELECT FLGENABLED AS enabled FROM MENU WHERE CODMNU = ?`;
    const result = await Orm.query(this.accessiOptions.databaseOptions, query, [codiceMenu])
      .then(results => results.map(RestUtilities.convertKeysToCamelCase)) as { enabled: number }[];

    if (!result?.length) {
      return null;
    }

    return result[0].enabled === 1;
  }

  public async getGroupEnabledStatus(codiceGruppo: string): Promise<boolean | null> {
    const query = `SELECT FLGENABLED AS enabled FROM MENU_GRP WHERE CODGRP = ?`;
    const result = await Orm.query(this.accessiOptions.databaseOptions, query, [codiceGruppo])
      .then(results => results.map(RestUtilities.convertKeysToCamelCase)) as { enabled: number }[];

    if (!result?.length) {
      return null;
    }

    return result[0].enabled === 1;
  }




}
