
import { Orm } from "../../../Orm";
import { RestUtilities } from "../../../Utilities";
import type { AccessiOptions } from "../../AccessiModule";
import { Permission, TipoAbilitazione } from "../../Dtos";
import { AbilitazioneMenu } from "../../Dtos/AbilitazioneMenu";
import { GroupWithMenusEntity } from "../../Dtos/GetGroupsWithMenusResponse";
import { MenuEntity } from "../../Dtos/GetMenusResponse";
import { Role } from "../../Dtos/Role";
import { Inject, Injectable } from "@nestjs/common";

/** Struttura storica menu/gruppi accettata dall'API legacy `addAbilitazioni`. */
type LegacyMenuGroup = {
    menu?: Array<{
        flgChk?: unknown;
        codiceMenu?: unknown;
        tipoAbilitazione?: unknown;
    }>;
};

@Injectable()
export class PermissionService {
    constructor(
        @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions
    ) { }

    private getCountFromResult(result: ReadonlyArray<Record<string, unknown>>, fieldName = 'COUNT'): number {
        const rawValue = result?.[0]?.[fieldName]
            ?? result?.[0]?.[fieldName.toLowerCase()]
            ?? result?.[0]?.count;
        return typeof rawValue === 'number' ? rawValue : Number.parseInt(`${rawValue ?? '0'}`, 10);
    }

    private extractIntegerColumn(result: ReadonlyArray<Record<string, unknown>>, fieldName: string): Set<number> {
        return new Set(
            result.map((row) => Number(row[fieldName] ?? row[fieldName.toLowerCase()])),
        );
    }

    private async getAllActiveMenusAsGrants(): Promise<AbilitazioneMenu[]> {
        const query = `
                SELECT
                    M.CODMNU AS codice_menu,
                    30 AS tipo_abilitazione,
                    M.DESMNU AS descrizione_menu,
                    G.DESGRP AS descrizione_gruppo,
                    G.CODGRP AS codice_gruppo,
                    M.ICON AS icona,
                    M.CODTIP AS tipo,
                    M.PAGINA AS pagina,
                    M.NOTE AS note
                FROM MENU M
                LEFT JOIN MENU_GRP G ON G.CODGRP = M.CODGRP
                WHERE M.FLGENABLED = 1 AND COALESCE(G.FLGENABLED, 1) = 1
            `;

        return await Orm.query(this.accessiOptions.databaseOptions, query, [])
            .then(results => results.map(RestUtilities.convertKeysToCamelCase)) as AbilitazioneMenu[];
    }

    private async getUserDirectPermissions(codiceUtente: number): Promise<AbilitazioneMenu[]> {
        const queryAbilitazioni = `
                SELECT
                    A.CODMNU AS codice_menu,
                    A.TIPABI AS tipo_abilitazione,
                    M.DESMNU AS descrizione_menu,
                    G.DESGRP AS descrizione_gruppo,
                    G.CODGRP AS codice_gruppo,
                    M.ICON AS icona,
                    M.CODTIP AS tipo,
                    M.PAGINA AS pagina,
                    M.NOTE AS note
                FROM ABILITAZIONI A
                INNER JOIN MENU M ON A.CODMNU = M.CODMNU
                LEFT JOIN MENU_GRP G ON G.CODGRP = M.CODGRP
                WHERE A.CODUTE = ? AND M.FLGENABLED = 1 AND COALESCE(G.FLGENABLED, 1) = 1
            `;

        return await Orm.query(this.accessiOptions.databaseOptions, queryAbilitazioni, [codiceUtente])
            .then(results => results.map(RestUtilities.convertKeysToCamelCase)) as AbilitazioneMenu[];
    }

    private async getUserRoles(codiceUtente: number): Promise<Role[]> {
        const queryRuoli = `
                SELECT
                    R.CODRUO AS codice_ruolo,
                    R.DESRUO AS descrizione_ruolo,
                    CASE WHEN COALESCE(G.FLGENABLED, 1) = 1 THEN M.CODMNU END AS codice_menu,
                    RM.TIPABI AS tipo_abilitazione,
                    M.DESMNU AS descrizione_menu,
                    M.NOTE AS note
                FROM UTENTI_RUOLI RU
                INNER JOIN RUOLI R ON RU.CODRUO = R.CODRUO
                LEFT JOIN RUOLI_MNU RM ON R.CODRUO = RM.CODRUO
                LEFT JOIN MENU M
                    ON RM.CODMNU = M.CODMNU
                    AND M.FLGENABLED = 1
                LEFT JOIN MENU_GRP G
                    ON G.CODGRP = M.CODGRP
                WHERE RU.CODUTE = ?
            `;
        const ruoliResult = (await Orm.query(this.accessiOptions.databaseOptions, queryRuoli, [codiceUtente]))
            .map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>;

        return this.assembleRoles(ruoliResult);
    }

    /** Costruisce l'albero ruoli/menu a partire dalle righe (riusato da lettura singola e batch). */
    private assembleRoles(ruoliResult: Array<Record<string, unknown>>): Role[] {
        const ruoliMap = new Map<number, Role>();
        for (const row of ruoliResult) {
            const codiceRuolo = Number(row.codiceRuolo);
            const descrizioneRuolo = typeof row.descrizioneRuolo === 'string' ? row.descrizioneRuolo.trim() : '';
            const codiceMenu = typeof row.codiceMenu === 'string' ? row.codiceMenu : undefined;
            const descrizioneMenu = typeof row.descrizioneMenu === 'string' ? row.descrizioneMenu : undefined;
            const tipoAbilitazione = Number(row.tipoAbilitazione) as TipoAbilitazione;

            if (!ruoliMap.has(codiceRuolo)) {
                ruoliMap.set(codiceRuolo, {
                    codiceRuolo,
                    descrizioneRuolo,
                    menu: []
                });
            }

            if (codiceMenu && descrizioneMenu) {
                ruoliMap.get(codiceRuolo)!.menu.push({
                    codiceRuolo,
                    codiceMenu,
                    tipoAbilitazione,
                });
            }
        }

        return Array.from(ruoliMap.values());
    }

    /** Regola di composizione storica: grant diretti prevalgono, i ruoli si sommano per livello massimo. */
    private composeGrants(
        abilitazioni: AbilitazioneMenu[],
        ruoli: Role[],
        isSuperAdmin: boolean,
        allActiveMenus: AbilitazioneMenu[],
    ): AbilitazioneMenu[] {
        const grantsMap = new Map<string, AbilitazioneMenu>();

        for (const abilitazione of abilitazioni) {
            grantsMap.set(abilitazione.codiceMenu, abilitazione);
        }

        const directMenuCodes = new Set(abilitazioni.map(grant => grant.codiceMenu));
        for (const ruolo of ruoli) {
            for (const menu of ruolo.menu) {
                const existing = grantsMap.get(menu.codiceMenu);
                if (!directMenuCodes.has(menu.codiceMenu) &&
                    (!existing || Number(menu.tipoAbilitazione) > Number(existing.tipoAbilitazione))) {
                    grantsMap.set(menu.codiceMenu, menu);
                }
            }
        }

        return isSuperAdmin ? allActiveMenus : Array.from(grantsMap.values());
    }


    /**
     * API legacy per salvare grant dalla struttura storica menu/gruppi.
     * Sostituisce tutti i grant diretti dell'utente; per le nuove integrazioni preferire `assignPermissionsToUser`.
     */
    public async addAbilitazioni(codiceUtente: number, menuAbilitazioni: LegacyMenuGroup[]): Promise<void> {
        const abilitazioniToInsert = menuAbilitazioni
            .flatMap(menuGrp => menuGrp.menu ?? [])
            .filter(menu => menu.flgChk)
            .map(menu => [codiceUtente, menu.codiceMenu, menu.tipoAbilitazione]);

        const insertQuery = `UPDATE OR INSERT INTO ABILITAZIONI (CODUTE, CODMNU, TIPABI) VALUES (?, ?, ?)`;

        // Delete + insert atomici: un errore a metà non lascia l'utente senza abilitazioni.
        await Orm.executeMultiple(this.accessiOptions.databaseOptions, [
            { query: `DELETE FROM ABILITAZIONI WHERE CODUTE = ?`, params: [codiceUtente] },
            ...abilitazioniToInsert.map(params => ({ query: insertQuery, params })),
        ]);
    }


    /** Rimuove tutti i grant diretti, senza toccare ruoli o menu ereditati dai ruoli. */
    public async resetAbilitazioni(codiceUtente: number): Promise<void> {
        const query = "DELETE FROM ABILITAZIONI WHERE CODUTE = ?";
        await Orm.execute(this.accessiOptions.databaseOptions, query, [codiceUtente]);
    }

    /**
     * Crea o aggiorna un ruolo. In aggiornamento la lista `role.menu` sostituisce integralmente i menu del ruolo.
     * Validare i codici menu nel chiamante quando si usano dati non provenienti dalla console o dalle API Accessi.
     */
    public async updateOrInsertRole(role: Role, codiceRuolo: number | null = null): Promise<void> {
        // Ruolo, sostituzione menu e inserimenti in un'unica transazione: niente ruoli senza menu in caso di errore.
        await Orm.withTransaction(this.accessiOptions.databaseOptions, async (transaction) => {
            let resolvedCodiceRuolo = codiceRuolo;

            if (resolvedCodiceRuolo == null) {
                const createdRoleResult = await Orm.transactionQuery<unknown>(
                    transaction,
                    `INSERT INTO RUOLI (DESRUO) VALUES (?) RETURNING CODRUO`,
                    [role.descrizioneRuolo],
                );
                const createdRole = (Array.isArray(createdRoleResult) ? createdRoleResult[0] : createdRoleResult) as Record<string, unknown> | undefined;
                const rawCodiceRuolo = createdRole?.CODRUO ?? createdRole?.codruo;
                const parsedCodiceRuolo = typeof rawCodiceRuolo === 'number'
                    ? rawCodiceRuolo
                    : Number.parseInt(`${rawCodiceRuolo ?? ''}`, 10);
                if (Number.isNaN(parsedCodiceRuolo)) {
                    throw new Error('Creazione ruolo non riuscita: impossibile recuperare CODRUO.');
                }
                resolvedCodiceRuolo = parsedCodiceRuolo;
            } else {
                await Orm.transactionQuery(
                    transaction,
                    `UPDATE RUOLI SET DESRUO = ? WHERE CODRUO = ?`,
                    [role.descrizioneRuolo, resolvedCodiceRuolo],
                );

                await Orm.transactionQuery(
                    transaction,
                    `DELETE FROM RUOLI_MNU WHERE CODRUO = ?`,
                    [resolvedCodiceRuolo],
                );
            }

            if (resolvedCodiceRuolo === null) {
                throw new Error('Operazione ruolo non riuscita: codice ruolo non valorizzato.');
            }

            for (const menu of role.menu) {
                await Orm.transactionQuery(
                    transaction,
                    `INSERT INTO RUOLI_MNU (CODRUO, CODMNU, TIPABI) VALUES (?, ?, ?)`,
                    [resolvedCodiceRuolo, menu.codiceMenu, menu.tipoAbilitazione],
                );
            }
        });
    }


    /** Restituisce il catalogo ruoli con ogni associazione menu e livello, inclusi ruoli senza menu. */
    public async getRolesWithMenus(): Promise<Role[]> {
        const query = `
                SELECT 
                    R.CODRUO AS codice_ruolo, 
                    R.DESRUO AS descrizione_ruolo, 
                    M.CODMNU AS codice_menu, 
                    M.DESMNU AS descrizione_menu,
                    M.NOTE AS note,
                    RM.TIPABI AS tipo_abilitazione
                FROM RUOLI R
                LEFT JOIN RUOLI_MNU RM ON R.CODRUO = RM.CODRUO
                LEFT JOIN MENU M ON RM.CODMNU = M.CODMNU
                ORDER BY R.CODRUO, M.CODMNU
            `;

        const result = (await Orm.query(this.accessiOptions.databaseOptions, query, []))
            .map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>;

        const ruoliMap = new Map<number, Role>();

        for (const row of result) {
            const codiceRuolo = Number(row.codiceRuolo);
            const descrizioneRuolo = typeof row.descrizioneRuolo === 'string' ? row.descrizioneRuolo.trim() : '';
            const codiceMenu = typeof row.codiceMenu === 'string' ? row.codiceMenu : undefined;
            const rawTipoAbilitazione = row.tipoAbilitazione;

            if (!ruoliMap.has(codiceRuolo)) {
                ruoliMap.set(codiceRuolo, {
                    codiceRuolo,
                    descrizioneRuolo,
                    menu: []
                });
            }

            const abilitationValue = typeof rawTipoAbilitazione === 'number'
                ? rawTipoAbilitazione
                : Number.parseInt(`${rawTipoAbilitazione ?? ''}`, 10);

            if (!codiceMenu || Number.isNaN(abilitationValue) || abilitationValue <= TipoAbilitazione.NESSUNA) {
                continue;
            }

            ruoliMap.get(codiceRuolo)!.menu.push({
                codiceRuolo,
                codiceMenu,
                tipoAbilitazione: abilitationValue as TipoAbilitazione,
            });
        }

        return Array.from(ruoliMap.values());
    }


    /**
     * Sostituisce l'intera lista di ruoli dell'utente con codici univoci e verificati.
     * Non modifica i grant diretti: il calcolo effettivo li unisce in `getUserRolesAndGrants`.
     */
    public async assignRolesToUser(codiceUtente: number, roles: number[]): Promise<void> {

        const userExistsQuery = `SELECT COUNT(*) FROM UTENTI WHERE CODUTE = ?`;
        let result = await Orm.query(this.accessiOptions.databaseOptions, userExistsQuery, [codiceUtente]);

        if (this.getCountFromResult(result) === 0) {
            throw new Error(`L'utente con codice ${codiceUtente} non esiste.`);
        }

        const normalizedRoles = Array.from(
            new Set(
                roles
                    .map((role) => Number.parseInt(`${role ?? ''}`, 10))
                    .filter((role) => Number.isInteger(role) && role > 0),
            ),
        );

        const queriesWithParams = [
            { query: `DELETE FROM UTENTI_RUOLI WHERE CODUTE = ?`, params: [codiceUtente] },
            ...normalizedRoles.map((codiceRuolo) => ({
                query: `INSERT INTO UTENTI_RUOLI (CODUTE, CODRUO) VALUES (?, ?)`,
                params: [codiceUtente, codiceRuolo],
            })),
        ];

        if (normalizedRoles.length > 0) {
            // Un'unica query IN invece di N count: stessa validazione, meno round-trip.
            const placeholders = normalizedRoles.map(() => '?').join(', ');
            const existingRolesResult = await Orm.query(
                this.accessiOptions.databaseOptions,
                `SELECT CODRUO FROM RUOLI WHERE CODRUO IN (${placeholders})`,
                normalizedRoles,
            );
            const existingRoles = this.extractIntegerColumn(existingRolesResult, 'CODRUO');
            const missingRole = normalizedRoles.find((codiceRuolo) => !existingRoles.has(codiceRuolo));
            if (missingRole !== undefined) {
                throw new Error(`Il ruolo con codice ${missingRole} non esiste.`);
            }
        }

        await Orm.executeMultiple(this.accessiOptions.databaseOptions, queriesWithParams);

        const assignedRolesResult = await Orm.query(
            this.accessiOptions.databaseOptions,
            `SELECT COUNT(*) FROM UTENTI_RUOLI WHERE CODUTE = ?`,
            [codiceUtente],
        );
        const assignedRolesCount = this.getCountFromResult(assignedRolesResult);
        if (assignedRolesCount !== normalizedRoles.length) {
            throw new Error(
                `Persistenza ruoli non coerente per utente ${codiceUtente}: attesi ${normalizedRoles.length}, trovati ${assignedRolesCount}.`,
            );
        }
    }


    /**
     * Sostituisce tutti i grant diretti dell'utente. I ruoli rimangono invariati e i loro grant sono aggiunti
     * solo nel risultato effettivo; un grant diretto dello stesso menu ha precedenza nella composizione.
     */
    public async assignPermissionsToUser(codiceUtente: number, permissions: Permission[]): Promise<void> {

        const userExistsQuery = `SELECT COUNT(*) FROM UTENTI WHERE CODUTE = ?`;
        let result = await Orm.query(this.accessiOptions.databaseOptions, userExistsQuery, [codiceUtente]);

        if (this.getCountFromResult(result) === 0) {
            throw new Error(`L'utente con codice ${codiceUtente} non esiste.`);
        }

        const normalizedPermissions = Array.from(
            new Map(
                permissions
                    .map((permission) => ({
                        codiceMenu: `${permission?.codiceMenu ?? ''}`.trim(),
                        tipoAbilitazione: Number.parseInt(`${permission?.tipoAbilitazione ?? ''}`, 10),
                    }))
                    .filter(
                        (permission) =>
                            permission.codiceMenu.length > 0 && Number.isInteger(permission.tipoAbilitazione),
                    )
                    .map((permission) => [permission.codiceMenu, permission] as const),
            ).values(),
        );

        const queriesWithParams = [
            { query: `DELETE FROM ABILITAZIONI WHERE CODUTE = ?`, params: [codiceUtente] },
            ...normalizedPermissions.map((permission) => ({
                query: `INSERT INTO ABILITAZIONI (CODUTE, CODMNU, TIPABI) VALUES (?, ?, ?)`,
                params: [codiceUtente, permission.codiceMenu, permission.tipoAbilitazione],
            })),
        ];

        if (normalizedPermissions.length > 0) {
            // Un'unica query IN invece di N count: stessa validazione, meno round-trip.
            const menuCodes = normalizedPermissions.map((permission) => permission.codiceMenu);
            const placeholders = menuCodes.map(() => '?').join(', ');
            const existingMenusResult = await Orm.query(
                this.accessiOptions.databaseOptions,
                `SELECT CODMNU FROM MENU WHERE CODMNU IN (${placeholders})`,
                menuCodes,
            );
            const existingMenus = new Set(
                existingMenusResult.map((row) => String((row as Record<string, unknown>).CODMNU ?? (row as Record<string, unknown>).codmnu ?? '')),
            );
            const missingMenu = menuCodes.find((codiceMenu) => !existingMenus.has(codiceMenu));
            if (missingMenu !== undefined) {
                throw new Error(`Il menu con codice ${missingMenu} non esiste.`);
            }
        }

        await Orm.executeMultiple(this.accessiOptions.databaseOptions, queriesWithParams);

        const assignedPermissionsResult = await Orm.query(
            this.accessiOptions.databaseOptions,
            `SELECT COUNT(*) FROM ABILITAZIONI WHERE CODUTE = ?`,
            [codiceUtente],
        );
        const assignedPermissionsCount = this.getCountFromResult(assignedPermissionsResult);
        if (assignedPermissionsCount !== normalizedPermissions.length) {
            throw new Error(
                `Persistenza abilitazioni non coerente per utente ${codiceUtente}: attese ${normalizedPermissions.length}, trovate ${assignedPermissionsCount}.`,
            );
        }
    }


    /** Elimina fisicamente ruolo, associazioni menu e assegnazioni utente. Operazione amministrativa irreversibile. */
    public async deleteRole(codiceRuolo: number): Promise<void> {

        const existsQuery = `SELECT COUNT(*) FROM RUOLI WHERE CODRUO = ?`;
        const result = await Orm.query(this.accessiOptions.databaseOptions, existsQuery, [codiceRuolo]);

        if (this.getCountFromResult(result) === 0) {
            throw new Error(`Il ruolo con codice ${codiceRuolo} non esiste.`);
        }

        // Le tre delete sono atomiche: nessun ruolo orfano se una fallisce.
        await Orm.executeMultiple(this.accessiOptions.databaseOptions, [
            { query: `DELETE FROM RUOLI_MNU WHERE CODRUO = ?`, params: [codiceRuolo] },
            { query: `DELETE FROM UTENTI_RUOLI WHERE CODRUO = ?`, params: [codiceRuolo] },
            { query: `DELETE FROM RUOLI WHERE CODRUO = ?`, params: [codiceRuolo] },
        ]);

    }


    /** Restituisce solo menu abilitati; per il catalogo amministrativo usare `getGroupsWithMenus(true)`. */
    public async getMenus(): Promise<MenuEntity[]> {
        const query = `
                SELECT 
                    M.CODMNU AS codiceMenu, 
                    M.DESMNU AS descrizioneMenu,
                    M.CODGRP AS codiceGruppo,
                    G.DESGRP AS descrizioneGruppo,
                    M.ICON AS icona,
                    M.CODTIP AS tipo,
                    M.PAGINA AS pagina,
                    M.NOTE AS note
                FROM MENU M
                LEFT JOIN MENU_GRP G ON M.CODGRP = G.CODGRP
                WHERE M.FLGENABLED = 1 AND COALESCE(G.FLGENABLED, 1) = 1
                ORDER BY G.CODGRP, M.CODMNU
            `;

        const result = await Orm.query(this.accessiOptions.databaseOptions, query, []);
        return result.map(RestUtilities.convertKeysToCamelCase) as unknown as MenuEntity[];
    }


    /**
     * Restituisce il catalogo ordinato per gruppo e menu. `includeDisabled` e riservato a console e amministrazione:
     * i flussi applicativi di autorizzazione devono usare il comportamento predefinito, che nasconde voci disabilitate.
     */
    public async getGroupsWithMenus(includeDisabled = false): Promise<GroupWithMenusEntity[]> {
        const filtersClause = includeDisabled
            ? ''
            : 'WHERE M.FLGENABLED = 1 AND (G.FLGENABLED IS NULL OR G.FLGENABLED = 1)';

        const query = `
                SELECT
                    M.CODMNU AS codice_menu,
                    M.DESMNU AS descrizione_menu,
                    M.CODGRP AS codice_gruppo,
                    G.DESGRP AS descrizione_gruppo,
                    M.ICON AS icona,
                    M.CODTIP AS tipo,
                    M.PAGINA AS pagina,
                    M.NOTE AS note,
                    G.ORDINE AS ordine_gruppo,
                    M.ORDINE as ordine_menu,
                    M.FLGENABLED AS menu_enabled,
                    G.FLGENABLED AS group_enabled
                FROM MENU M
                LEFT JOIN MENU_GRP G ON M.CODGRP = G.CODGRP
                ${filtersClause}
                ORDER BY G.CODGRP, M.CODMNU
            `;

        const result = await Orm.query(this.accessiOptions.databaseOptions, query, []);

        const groupMap = new Map<
            string,
            GroupWithMenusEntity & { menus: (MenuEntity & { enabled?: boolean })[] }
        >();

        result.forEach((row: unknown) => {
            const converted = RestUtilities.convertKeysToCamelCase(row) as MenuEntity & {
                menuEnabled?: number | boolean;
                groupEnabled?: number | boolean;
            };

            const { menuEnabled, groupEnabled, ...menuBase } = converted;
            const normalizedGroupKey = menuBase.codiceGruppo ?? '__UNGROUPED__';
            const groupEnabledFlag =
                groupEnabled == null ? true : Number(groupEnabled) === 1 || groupEnabled === true;
            const menuEnabledFlag =
                menuEnabled === undefined ? true : Number(menuEnabled) === 1 || menuEnabled === true;

            if (!groupMap.has(normalizedGroupKey)) {
                groupMap.set(normalizedGroupKey, {
                    codiceGruppo: menuBase.codiceGruppo ?? normalizedGroupKey,
                    descrizioneGruppo: menuBase.descrizioneGruppo ?? '',
                    ordineGruppo: menuBase.ordineGruppo,
                    enabled: groupEnabledFlag,
                    menus: [],
                });
            }

            if (menuBase.codiceMenu) {
                groupMap.get(normalizedGroupKey)!.menus.push({
                    ...menuBase,
                    enabled: menuEnabledFlag,
                });
            }
        });

        const groupsArray = Array.from(groupMap.values())
            .map(group => ({
                ...group,
                menus: (group.menus ?? []).sort(
                    (a, b) =>
                        (a.ordineMenu ?? Number.MAX_SAFE_INTEGER) - (b.ordineMenu ?? Number.MAX_SAFE_INTEGER),
                ),
            }))
            .sort(
                (a, b) =>
                    (a.ordineGruppo ?? Number.MAX_SAFE_INTEGER) - (b.ordineGruppo ?? Number.MAX_SAFE_INTEGER),
            );

        return groupsArray;
    }



    /**
     * Calcola l'autorizzazione effettiva: grant diretti e grant dei ruoli sono uniti per codice menu.
     * Per compatibilita storica un grant diretto prevale su quello del ruolo; i superutenti ricevono tutti i menu attivi.
     */
    public async getUserRolesAndGrants(codiceUtente: number): Promise<{
        abilitazioni: AbilitazioneMenu[],
        ruoli: Role[],
        grants: AbilitazioneMenu[]
    }> {
        const codiceUtenteQuery = "SELECT FLGSUPER as flag_super FROM UTENTI_CONFIG WHERE CODUTE = ?";
        const result = await Orm.query(this.accessiOptions.databaseOptions, codiceUtenteQuery, [codiceUtente]);
        if (!result || result.length == 0) throw new Error("Nessun utente trovato con il codice utente " + codiceUtente);

        const isSuperAdmin = this.isSuperFlag(
            (result.map(RestUtilities.convertKeysToCamelCase)[0] as { flagSuper?: unknown } | undefined)?.flagSuper,
        );

        const abilitazioni = await this.getUserDirectPermissions(codiceUtente);
        const ruoli = await this.getUserRoles(codiceUtente);
        const grants = this.composeGrants(
            abilitazioni,
            ruoli,
            isSuperAdmin,
            isSuperAdmin ? await this.getAllActiveMenusAsGrants() : [],
        );

        return { abilitazioni, ruoli, grants };
    }

    private isSuperFlag(value: unknown): boolean {
        return value === true || value === 1 || value === '1';
    }

    /**
     * Versione batch di `getUserRolesAndGrants`: esegue un numero costante di query per N utenti
     * (invece di N set di query) e restituisce mappa per codice utente. Stessa composizione della
     * lettura singola.
     */
    public async getUsersRolesAndGrants(codiciUtente: number[]): Promise<Map<number, {
        abilitazioni: AbilitazioneMenu[],
        ruoli: Role[],
        grants: AbilitazioneMenu[]
    }>> {
        const result = new Map<number, { abilitazioni: AbilitazioneMenu[], ruoli: Role[], grants: AbilitazioneMenu[] }>();
        const ids = Array.from(new Set(codiciUtente.filter((id) => Number.isInteger(id) && id > 0)));
        if (ids.length === 0) {
            return result;
        }

        const placeholders = ids.map(() => '?').join(', ');

        const superRows = (await Orm.query(
            this.accessiOptions.databaseOptions,
            `SELECT CODUTE AS codice_utente, FLGSUPER AS flag_super FROM UTENTI_CONFIG WHERE CODUTE IN (${placeholders})`,
            ids,
        )).map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>;
        const superUsers = new Set<number>();
        for (const row of superRows) {
            if (this.isSuperFlag(row.flagSuper)) {
                superUsers.add(Number(row.codiceUtente));
            }
        }

        const permissionRows = (await Orm.query(
            this.accessiOptions.databaseOptions,
            `SELECT
                A.CODUTE AS codice_utente,
                A.CODMNU AS codice_menu,
                A.TIPABI AS tipo_abilitazione,
                M.DESMNU AS descrizione_menu,
                G.DESGRP AS descrizione_gruppo,
                G.CODGRP AS codice_gruppo,
                M.ICON AS icona,
                M.CODTIP AS tipo,
                M.PAGINA AS pagina,
                M.NOTE AS note
            FROM ABILITAZIONI A
            INNER JOIN MENU M ON A.CODMNU = M.CODMNU
            LEFT JOIN MENU_GRP G ON G.CODGRP = M.CODGRP
            WHERE A.CODUTE IN (${placeholders}) AND M.FLGENABLED = 1 AND COALESCE(G.FLGENABLED, 1) = 1`,
            ids,
        )).map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>;

        const roleRows = (await Orm.query(
            this.accessiOptions.databaseOptions,
            `SELECT
                RU.CODUTE AS codice_utente,
                R.CODRUO AS codice_ruolo,
                R.DESRUO AS descrizione_ruolo,
                CASE WHEN COALESCE(G.FLGENABLED, 1) = 1 THEN M.CODMNU END AS codice_menu,
                RM.TIPABI AS tipo_abilitazione,
                M.DESMNU AS descrizione_menu,
                M.NOTE AS note
            FROM UTENTI_RUOLI RU
            INNER JOIN RUOLI R ON RU.CODRUO = R.CODRUO
            LEFT JOIN RUOLI_MNU RM ON R.CODRUO = RM.CODRUO
            LEFT JOIN MENU M ON RM.CODMNU = M.CODMNU AND M.FLGENABLED = 1
            LEFT JOIN MENU_GRP G ON G.CODGRP = M.CODGRP
            WHERE RU.CODUTE IN (${placeholders})`,
            ids,
        )).map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>;

        const allActiveMenus = superUsers.size > 0 ? await this.getAllActiveMenusAsGrants() : [];

        const permissionsByUser = new Map<number, AbilitazioneMenu[]>();
        for (const row of permissionRows) {
            const { codiceUtente, ...grant } = row;
            const key = Number(codiceUtente);
            const bucket = permissionsByUser.get(key);
            if (bucket) {
                bucket.push(grant as unknown as AbilitazioneMenu);
            } else {
                permissionsByUser.set(key, [grant as unknown as AbilitazioneMenu]);
            }
        }

        const rolesByUser = new Map<number, Array<Record<string, unknown>>>();
        for (const row of roleRows) {
            const { codiceUtente, ...roleRow } = row;
            const key = Number(codiceUtente);
            const bucket = rolesByUser.get(key);
            if (bucket) {
                bucket.push(roleRow);
            } else {
                rolesByUser.set(key, [roleRow]);
            }
        }

        for (const id of ids) {
            const abilitazioni = permissionsByUser.get(id) ?? [];
            const ruoli = this.assembleRoles(rolesByUser.get(id) ?? []);
            const isSuperAdmin = superUsers.has(id);
            result.set(id, {
                abilitazioni,
                ruoli,
                grants: this.composeGrants(abilitazioni, ruoli, isSuperAdmin, isSuperAdmin ? allActiveMenus : []),
            });
        }

        return result;
    }



}


