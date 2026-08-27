
import { Orm } from "../../../Orm";
import { RestUtilities } from "../../../Utilities";
import { AccessiOptions } from "../../AccessiModule";
import { Permission, TipoAbilitazione } from "../../Dtos";
import { AbilitazioneMenu } from "../../Dtos/AbilitazioneMenu";
import { GroupWithMenusEntity } from "../../Dtos/GetGroupsWithMenusResponse";
import { MenuEntity } from "../../Dtos/GetMenusResponse";
import { Role } from "../../Dtos/Role";
import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class PermissionService {
    constructor(
        @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions
    ) { }

    private getCountFromResult(result: any[], fieldName = 'COUNT'): number {
        const rawValue = result?.[0]?.[fieldName]
            ?? result?.[0]?.[fieldName.toLowerCase()]
            ?? result?.[0]?.count;
        return typeof rawValue === 'number' ? rawValue : Number.parseInt(`${rawValue ?? '0'}`, 10);
    }


    public async addAbilitazioni(codiceUtente: number, menuAbilitazioni: any[]): Promise<void> {
        const deleteQuery = `DELETE FROM ABILITAZIONI WHERE CODUTE = ?`;
        await Orm.execute(this.accessiOptions.databaseOptions, deleteQuery, [codiceUtente]);

        const abilitazioniToInsert = menuAbilitazioni
            .flatMap(menuGrp => menuGrp.menu)
            .filter(menu => menu.flgChk)
            .map(menu => [codiceUtente, menu.codiceMenu, menu.tipoAbilitazione]);

        const insertQuery = `UPDATE OR INSERT INTO ABILITAZIONI (CODUTE, CODMNU, TIPABI) VALUES (?, ?, ?)`;

        for (const params of abilitazioniToInsert) {
            await Orm.execute(this.accessiOptions.databaseOptions, insertQuery, params);
        }
    }


    public async resetAbilitazioni(codiceUtente: number): Promise<void> {
        const query = "DELETE FROM ABILITAZIONI WHERE CODUTE = ?";
        await Orm.execute(this.accessiOptions.databaseOptions, query, [codiceUtente]);
    }

    public async updateOrInsertRole(role: Role, codiceRuolo: number | null = null): Promise<void> {

        // creazione nuovo ruolo
        if (codiceRuolo == null) {
            const createRoleQuery = `INSERT INTO RUOLI (DESRUO) VALUES (?)`;
            await Orm.execute(this.accessiOptions.databaseOptions, createRoleQuery, [role.descrizioneRuolo]);

            const createdRoleResult = await Orm.query(
                this.accessiOptions.databaseOptions,
                'SELECT FIRST 1 CODRUO FROM RUOLI WHERE DESRUO = ? ORDER BY CODRUO DESC',
                [role.descrizioneRuolo]
            );
            const rawCodiceRuolo = createdRoleResult?.[0]?.CODRUO ?? createdRoleResult?.[0]?.codruo;
            const parsedCodiceRuolo = typeof rawCodiceRuolo === 'number'
                ? rawCodiceRuolo
                : Number.parseInt(`${rawCodiceRuolo ?? ''}`, 10);
            if (Number.isNaN(parsedCodiceRuolo)) {
                throw new Error('Creazione ruolo non riuscita: impossibile recuperare CODRUO.');
            }
            codiceRuolo = parsedCodiceRuolo;
        } else {
            // aggiornamento ruolo esistente
            const updateRoleQuery = `UPDATE RUOLI SET DESRUO = ? WHERE CODRUO = ?`;
            await Orm.execute(this.accessiOptions.databaseOptions, updateRoleQuery, [role.descrizioneRuolo, codiceRuolo]);

            const deleteRoleMenuQuery = `DELETE FROM RUOLI_MNU WHERE CODRUO = ?`;
            await Orm.execute(this.accessiOptions.databaseOptions, deleteRoleMenuQuery, [codiceRuolo]);
        }

        if (codiceRuolo === null) {
            throw new Error('Operazione ruolo non riuscita: codice ruolo non valorizzato.');
        }

        const createRoleMenuQuery = `INSERT INTO RUOLI_MNU (CODRUO, CODMNU, TIPABI) VALUES (?, ?, ?)`;
        for (const menu of role.menu) {
            await Orm.execute(this.accessiOptions.databaseOptions, createRoleMenuQuery, [codiceRuolo, menu.codiceMenu, menu.tipoAbilitazione]);
        }

    }


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

        let result = await Orm.query(this.accessiOptions.databaseOptions, query, []);
        result = result.map(RestUtilities.convertKeysToCamelCase);

        const ruoliMap = new Map<number, Role>();

        for (const row of result) {
            const { codiceRuolo, descrizioneRuolo, codiceMenu, descrizioneMenu, tipoAbilitazione } = row;

            if (!ruoliMap.has(codiceRuolo)) {
                ruoliMap.set(codiceRuolo, {
                    codiceRuolo,
                    descrizioneRuolo: descrizioneRuolo?.trim(),
                    menu: []
                });
            }

            const abilitationValue = typeof tipoAbilitazione === 'number'
                ? tipoAbilitazione
                : Number.parseInt(`${tipoAbilitazione ?? ''}`, 10);

            if (!codiceMenu || Number.isNaN(abilitationValue) || abilitationValue <= TipoAbilitazione.NESSUNA) {
                continue;
            }

            ruoliMap.get(codiceRuolo)!.menu.push({
                codiceRuolo: codiceRuolo,
                codiceMenu: codiceMenu.trim(),
                tipoAbilitazione: abilitationValue as TipoAbilitazione,
            });
        }

        return Array.from(ruoliMap.values());
    }


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

        if (normalizedRoles.length === 0) {
            throw new Error('Nessun ruolo valido da assegnare.');
        }

        const roleExistsQuery = `SELECT COUNT(*) FROM RUOLI WHERE CODRUO = ?`;
        for (const codiceRuolo of normalizedRoles) {
            const roleResult = await Orm.query(this.accessiOptions.databaseOptions, roleExistsQuery, [codiceRuolo]);
            if (this.getCountFromResult(roleResult) === 0) {
                throw new Error(`Il ruolo con codice ${codiceRuolo} non esiste.`);
            }
        }

        const queriesWithParams = [
            { query: `DELETE FROM UTENTI_RUOLI WHERE CODUTE = ?`, params: [codiceUtente] },
            ...normalizedRoles.map((codiceRuolo) => ({
                query: `INSERT INTO UTENTI_RUOLI (CODUTE, CODRUO) VALUES (?, ?)`,
                params: [codiceUtente, codiceRuolo],
            })),
        ];
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

        if (normalizedPermissions.length === 0) {
            throw new Error('Nessuna abilitazione valida da assegnare.');
        }

        const menuExistsQuery = `SELECT COUNT(*) FROM MENU WHERE CODMNU = ?`;
        for (const permission of normalizedPermissions) {
            const menuResult = await Orm.query(this.accessiOptions.databaseOptions, menuExistsQuery, [permission.codiceMenu]);
            if (this.getCountFromResult(menuResult) === 0) {
                throw new Error(`Il menu con codice ${permission.codiceMenu} non esiste.`);
            }
        }

        const queriesWithParams = [
            { query: `DELETE FROM ABILITAZIONI WHERE CODUTE = ?`, params: [codiceUtente] },
            ...normalizedPermissions.map((permission) => ({
                query: `INSERT INTO ABILITAZIONI (CODUTE, CODMNU, TIPABI) VALUES (?, ?, ?)`,
                params: [codiceUtente, permission.codiceMenu, permission.tipoAbilitazione],
            })),
        ];
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


    public async deleteRole(codiceRuolo: number): Promise<void> {

        const existsQuery = `SELECT COUNT(*) FROM RUOLI WHERE CODRUO = ?`;
        let result = await Orm.query(this.accessiOptions.databaseOptions, existsQuery, [codiceRuolo]);

        if (result[0].COUNT === 0) {
            throw new Error(`Il ruolo con codice ${codiceRuolo} non esiste.`);
        }

        const deleteRoleMenusQuery = `DELETE FROM RUOLI_MNU WHERE CODRUO = ?`;
        await Orm.execute(this.accessiOptions.databaseOptions, deleteRoleMenusQuery, [codiceRuolo]);

        const deleteRoleUsersQuery = `DELETE FROM UTENTI_RUOLI WHERE CODRUO = ?`;
        await Orm.execute(this.accessiOptions.databaseOptions, deleteRoleUsersQuery, [codiceRuolo]);

        const deleteRoleQuery = `DELETE FROM RUOLI WHERE CODRUO = ?`;
        await Orm.execute(this.accessiOptions.databaseOptions, deleteRoleQuery, [codiceRuolo]);

    }


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
                WHERE M.FLGENABLED = 1
                ORDER BY G.CODGRP, M.CODMNU
            `;

        const result = await Orm.query(this.accessiOptions.databaseOptions, query, []);
        return result.map(RestUtilities.convertKeysToCamelCase);
    }


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

        result.forEach(row => {
            const converted = RestUtilities.convertKeysToCamelCase(row) as MenuEntity & {
                menuEnabled?: number | boolean;
                groupEnabled?: number | boolean;
            };

            const { menuEnabled, groupEnabled, ...menuBase } = converted as any;
            const normalizedGroupKey = menuBase.codiceGruppo ?? '__UNGROUPED__';
            const groupEnabledFlag =
                groupEnabled === undefined ? true : Number(groupEnabled) === 1 || groupEnabled === true;
            const menuEnabledFlag =
                menuEnabled === undefined ? true : Number(menuEnabled) === 1 || menuEnabled === true;

            if (!groupMap.has(normalizedGroupKey)) {
                groupMap.set(normalizedGroupKey, {
                    codiceGruppo: menuBase.codiceGruppo ?? normalizedGroupKey,
                    descrizioneGruppo: menuBase.descrizioneGruppo,
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



    public async getUserRolesAndGrants(codiceUtente: number): Promise<{
        abilitazioni: AbilitazioneMenu[],
        ruoli: Role[],
        grants: AbilitazioneMenu[]
    }> {
        const codiceUtenteQuery = "SELECT FLGSUPER as flag_super FROM UTENTI_CONFIG WHERE CODUTE = ?";
        let result = await Orm.query(this.accessiOptions.databaseOptions, codiceUtenteQuery, [codiceUtente]);
        if (!result || result.length == 0) throw new Error("Nessun utente trovato con il codice utente " + codiceUtente);

        result = result.map(RestUtilities.convertKeysToCamelCase) as { flagSuper: boolean }[];
        const isSuperAdmin = result[0].flagSuper;

        let abilitazioni: AbilitazioneMenu[] = [];
        let ruoli: Role[] = [];

        if (isSuperAdmin) {
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
            abilitazioni = await Orm.query(this.accessiOptions.databaseOptions, query, [])
                .then(results => results.map(RestUtilities.convertKeysToCamelCase)) as AbilitazioneMenu[];
        } else {
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
            abilitazioni = await Orm.query(this.accessiOptions.databaseOptions, queryAbilitazioni, [codiceUtente])
                .then(results => results.map(RestUtilities.convertKeysToCamelCase)) as AbilitazioneMenu[];

            const queryRuoli = `
                    SELECT
                        R.CODRUO AS codice_ruolo,
                        R.DESRUO AS descrizione_ruolo,
                        RM.CODMNU AS codice_menu,
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
                        AND COALESCE(G.FLGENABLED, 1) = 1
                    WHERE RU.CODUTE = ?
                `;
            let ruoliResult = await Orm.query(this.accessiOptions.databaseOptions, queryRuoli, [codiceUtente]);
            ruoliResult = ruoliResult.map(RestUtilities.convertKeysToCamelCase);

            const ruoliMap = new Map<number, Role>();
            for (const row of ruoliResult) {
                const { codiceRuolo, descrizioneRuolo, codiceMenu, descrizioneMenu, tipoAbilitazione } = row;

                if (!ruoliMap.has(codiceRuolo)) {
                    ruoliMap.set(codiceRuolo, {
                        codiceRuolo,
                        descrizioneRuolo: descrizioneRuolo?.trim(),
                        menu: []
                    });
                }

                if (codiceMenu && descrizioneMenu) {
                    ruoliMap.get(codiceRuolo)!.menu.push({
                        codiceRuolo: codiceRuolo,
                        codiceMenu: codiceMenu.trim(),
                        tipoAbilitazione,
                    });
                }
            }

            ruoli = Array.from(ruoliMap.values());
        }

        // Merge user-specific and role-based permissions
        const grantsMap = new Map<string, AbilitazioneMenu>();

        // Add user-specific permissions
        for (const abilitazione of abilitazioni) {
            grantsMap.set(abilitazione.codiceMenu, abilitazione);
        }

        // Add role-based permissions if not already present
        for (const ruolo of ruoli) {
            for (const menu of ruolo.menu) {
                if (!grantsMap.has(menu.codiceMenu)) {
                    grantsMap.set(menu.codiceMenu, menu);
                }
            }
        }

        const grants = Array.from(grantsMap.values());

        return { abilitazioni, ruoli, grants };
    }



}


