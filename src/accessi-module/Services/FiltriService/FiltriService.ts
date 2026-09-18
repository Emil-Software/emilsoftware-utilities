import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { getTableColumns, optionalColumn } from '../../database-updates/optionalColumns';
import type { AccessiOptions } from '../../AccessiModule';
import { TipoFiltro } from '../../Dtos/TipoFiltro';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import { Logger } from '../../../Logger';
import { FiltriUtente, FILTRI_UTENTE_DB_MAPPING } from '../../Dtos';

@Injectable()
/** Persists application-specific filter dimensions associated with an Accessi user. */
export class FiltriService {
  private readonly logger = new Logger(FiltriService.name);
  constructor(@Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions) {}

  /** Returns the enabled filter-type catalog used by legacy and configurator clients. */
  public async getTipoFiltri(): Promise<TipoFiltro[]> {
    try {
      const getQuery =
        'SELECT TIPFIL AS TIP_FIL, DESFIL AS DES_FIL, FLDFIL AS FLD_FIL, FLGENABLED AS FLG_ENABLED FROM FILTRI_TIPO';
      const params: unknown[] = [];

      const result = await Orm.query(this.accessiOptions.databaseOptions, getQuery, params);
      return result.map(RestUtilities.convertKeysToCamelCase) as unknown as TipoFiltro[];
    } catch (error) {
      this.logger.error('Errore durante il recupero dei tipi di filtri', error);
      throw error;
    }
  }

  /** Returns filters for one user; omit the code only for trusted administrative reporting. */
  public async getFiltriUser(codUte: number | undefined): Promise<FiltriUtente[]> {
    try {
      const params: unknown[] = [];

      const columns = await getTableColumns(this.accessiOptions, 'FILTRI');
      const aliases = { PROG: 'PROGRESSIVO', NUMREP: 'NUM_REP', IDXPERS: 'IDX_PERS', CODCLISUPER: 'COD_CLI_SUPER', CODAGE: 'COD_AGE', CODCLICOL: 'COD_CLI_COL', CODCLIENTI: 'COD_CLIENTI', TIPFIL: 'TIP_FIL', CODDIP: 'COD_DIP', IDXPOS: 'IDX_POS', CODVET: 'COD_VET' };
      const selections = Object.values(FILTRI_UTENTE_DB_MAPPING).map(cfg => optionalColumn(columns, cfg.dbField, 'F', aliases[cfg.dbField], cfg.numeric));
      let getQuery = `SELECT F.CODUTE AS COD_UTE, ${selections.join(', ')} FROM FILTRI F `;

      if (codUte === undefined) {
        this.logger.log('Nessun utente passato, recupero i filtri di tutti gli utenti...');
      } else {
        this.logger.log('codUte passato, recupero i filtri dell utente ' + codUte);
        getQuery += ' WHERE CODUTE = ?';
        params.push(codUte);
      }

      const result = await Orm.query(this.accessiOptions.databaseOptions, getQuery, params);
      return result.map(RestUtilities.convertKeysToCamelCase) as unknown as FiltriUtente[];
    } catch (error) {
      throw error;
    }
  }

  /** Validate before a caller creates or updates user data. */
  public async validateSupportedFields(dto: Partial<FiltriUtente>, columns?: Set<string>): Promise<Set<string>> {
    columns ??= await getTableColumns(this.accessiOptions, 'FILTRI');
    for (const [key, cfg] of Object.entries(FILTRI_UTENTE_DB_MAPPING)) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && value !== '' && !columns.has(cfg.dbField)) {
        throw new BadRequestException(`Filtro applicativo non configurato: FILTRI.${cfg.dbField}`);
      }
    }
    return columns;
  }

  /**
   * Upserts only supplied mapped fields. `undefined` leaves a field unchanged; `null` or an empty string clears it.
   * The mapping is centralized in `FILTRI_UTENTE_DB_MAPPING` to keep DTO and database names decoupled.
   */
  public async upsertFiltriUtente(codUte: number, dto: Partial<FiltriUtente>): Promise<void> {
    try {
      if (!codUte || codUte <= 0) throw new Error('Codice utente non valido');

      const columns = await this.validateSupportedFields(dto);
      const dbFields: string[] = ['CODUTE'];
      const values: unknown[] = [codUte];

      //aggiungo solo campi valorizzati
      for (const [key, cfg] of Object.entries(FILTRI_UTENTE_DB_MAPPING)) {
        const value = (dto as Record<string, unknown>)[key];

        //gestione campi vuoti, null o undefined
        if (value === undefined || !columns.has(cfg.dbField)) {
          continue
        }

        if (value === null || value === '') {
          dbFields.push(cfg.dbField);
          values.push(null);
          continue
        }
        if (cfg.numeric && typeof value !== 'number') {
          throw new Error(`Il campo ${key} deve essere un numero`);
        }
        if (!cfg.numeric && typeof value !== 'string') {
          throw new Error(`Il campo ${key} deve essere una stringa`);
        }
        dbFields.push(cfg.dbField);
        values.push(value);
      }

      if (dbFields.length === 1) {
        this.logger.log(`Nessun campo valido da inserire per l'utente ${codUte}`)
        return
      }

      let sSql = `UPDATE OR INSERT INTO FILTRI (${dbFields.join(',')}) VALUES (${values.map(() => '?').join(', ')}) MATCHING (CODUTE)`
      await Orm.execute(this.accessiOptions.databaseOptions, sSql, values)

      this.logger.log('Update or Insert filtri OK per CODUTE = ' + codUte)

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Errore durante update or insert filtri per utente ${codUte}: ${message}`);
    }
  }
}
