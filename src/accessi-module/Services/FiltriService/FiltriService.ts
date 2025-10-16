import { Inject, Injectable } from '@nestjs/common';
import { AccessiOptions } from '../../AccessiModule';
import { TipoFiltro } from '../../Dtos/TipoFiltro';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import { Logger } from '../../../Logger';
import { FiltriUtente, FILTRI_UTENTE_DB_MAPPING } from '../../Dtos';

@Injectable()
export class FiltriService {
  private readonly logger = new Logger(FiltriService.name);
  constructor(@Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions) {}

  public async getTipoFiltri(): Promise<TipoFiltro[]> {
    try {
      let getQuery =
        'SELECT TIPFIL AS TIP_FIL, DESFIL AS DES_FIL, FLDFIL AS FLD_FIL, FLGENABLED AS FLG_ENABLED FROM FILTRI_TIPO';
      const params = [];

      let result = await Orm.query(this.accessiOptions.databaseOptions, getQuery, params);
      return result.map(RestUtilities.convertKeysToCamelCase);
    } catch (error) {
      this.logger.error('Errore durante il recupero dei tipi di filtri', error);
      throw error;
    }
  }

  public async getFiltriUser(codUte: number): Promise<FiltriUtente[]> {
    try {
      let params = [];

      let getQuery = `SELECT CODUTE AS COD_UTE, PROG AS PROGRESSIVO, NUMREP AS NUM_REP, IDXPERS AS IDX_PERS, CODCLISUPER AS COD_CLI_SUPER, CODAGE AS COD_AGE, CODCLICOL AS COD_CLI_COL,
        CODCLIENTI AS COD_CLIENTI, TIPFIL AS TIP_FIL, CODDIP AS COD_DIP, IDXPOS AS IDX_POS, CODVET AS COD_VET FROM FILTRI `;

      if (codUte === undefined) {
        this.logger.log('Nessun utente passato, recupero i filtri di tutti gli utenti...');
      } else {
        this.logger.log('codUte passato, recupero i filtri dell utente ' + codUte);
        getQuery += ' WHERE CODUTE = ?';
        params.push(codUte);
      }

      let result = await Orm.query(this.accessiOptions.databaseOptions, getQuery, params);
      return result.map(RestUtilities.convertKeysToCamelCase);
    } catch (error) {
      throw error;
    }
  }

  public async upsertFiltriUtente(codUte: number, dto: Partial<FiltriUtente>): Promise<void> {
    try {
      console.debug('Dati utente da aggiornare: ', dto)
      if (!codUte || codUte <= 0) throw new Error('Codice utente non valido');

      const dbFields: string[] = ['CODUTE'];
      const values: any[] = [codUte];

      //aggiungo solo campi valorizzati
      for (const [key, cfg] of Object.entries(FILTRI_UTENTE_DB_MAPPING)) {
        console.log('valuto campo: ', key)
        const value = (dto as any)[key];

        //gestione campi vuoti, null o undefined
        if (value === undefined) {
          console.log(`Campo ${key} vuoto: ${value}`)
          continue
        }

        if (value === null || value === '') {
          dbFields.push(cfg.dbField);
          values.push(null);
          continue
        }



        // if (value === undefined || value === null || value === '') {
        //   console.log(`Campo ${key} vuoto: ${value}`)
        //   continue;
        // }

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
      throw new Error(`Errore durante update or insert filtri per utente ${codUte}: ${error.message}`);

    }
  }
}
