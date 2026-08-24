import { Orm } from "./Orm";
import { Logger } from "./Logger";
import { Options } from "node-firebird";

export abstract class DatabaseUpdater {
  //#region Fields and Options
  protected static options: Options;
  protected static logger: Logger = new Logger(DatabaseUpdater.name);
  protected static readonly versionParameterKeys = ["VersioneDB", "DBVERSION"];
  //#endregion

  //#region Utility Methods
  /**
   * Checks if a table exists.
   * @param options Database connection options.
   * @param table Table name.
   * @returns True if the table exists, false otherwise.
   */
  protected static async tableExists(
    options: Options,
    table: string
  ): Promise<boolean> {

    try {
      const query = `
      SELECT 1
      FROM RDB$RELATIONS
      WHERE RDB$RELATION_NAME = ?
        AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0`;
      const result = await Orm.query(options, query, [table.toUpperCase()]);
      return result.length > 0;
    } catch (error: any) {
      this.logger.error(`Error checking table ${table}:`, error);
      throw error;
    }
  }

  /**
   * Checks if a column exists in a specific table.
   * @param options Database connection options.
   * @param table Table name.
   * @param column Column name.
   * @returns True if the column exists, false otherwise.
   */
  protected static async columnExists(
    options: Options,
    table: string,
    column: string
  ): Promise<boolean> {

    try {
      const query = `
      SELECT 1 
      FROM RDB$RELATION_FIELDS 
      WHERE RDB$RELATION_NAME = ? 
        AND RDB$FIELD_NAME = ?`;
      const result = await Orm.query(options, query, [
        table.toUpperCase(),
        column.toUpperCase(),
      ]);
      return result.length > 0;
    } catch (error: any) {
      this.logger.error(`Error checking column ${column} on table ${table}:`, error);
      throw error;
    }
  }

  /**
   * Checks if a generator/sequence exists.
   * @param options Database connection options.
   * @param generator Generator name.
   * @returns True if the generator exists, false otherwise.
   */
  protected static async generatorExists(
    options: Options,
    generator: string
  ): Promise<boolean> {

    try {
      const query = `
      SELECT 1
      FROM RDB$GENERATORS
      WHERE RDB$GENERATOR_NAME = ?`;
      const result = await Orm.query(options, query, [generator.toUpperCase()]);
      return result.length > 0;
    } catch (error: any) {
      this.logger.error(`Error checking generator ${generator}:`, error);
      throw error;
    }
  }

  /**
   * Checks if a trigger exists.
   * @param options Database connection options.
   * @param trigger Trigger name.
   * @returns True if the trigger exists, false otherwise.
   */
  protected static async triggerExists(
    options: Options,
    trigger: string
  ): Promise<boolean> {

    try {
      const query = `
      SELECT 1
      FROM RDB$TRIGGERS
      WHERE RDB$TRIGGER_NAME = ?
        AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0`;
      const result = await Orm.query(options, query, [trigger.toUpperCase()]);
      return result.length > 0;
    } catch (error: any) {
      this.logger.error(`Error checking trigger ${trigger}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves the current database version from the PARAMETRI table.
   * @param options Database connection options.
   * @returns The current database version or null if not found.
   */
  protected static async getDatabaseVersion(options: Options): Promise<string | null> {

    try {
      if (!(await this.tableExists(options, "PARAMETRI"))) {
        return null;
      }

      const parameters = (await Orm.query(
        options,
        `SELECT CODPAR, DESPAR
         FROM PARAMETRI
         WHERE CODPAR IN (?, ?)
         ORDER BY CASE WHEN CODPAR = ? THEN 0 ELSE 1 END`,
        [
          this.versionParameterKeys[0],
          this.versionParameterKeys[1],
          this.versionParameterKeys[0],
        ]
      )) as any[];

      return parameters.length > 0 ? parameters[0].DESPAR : null;
    } catch (error: any) {
      this.logger.error(`Error getting database version:`, error);
      throw error;
    }
  }

  /**
   * Updates the database version in the PARAMETRI table.
   * @param options Database connection options.
   * @param version The new database version.
   */
  protected static async setDatabaseVersion(
    options: Options,
    version: string
  ): Promise<void> {

    try {
      if (!(await this.tableExists(options, "PARAMETRI"))) {
        await this.createParametersTable(options);
      }

      const existingRows = (await Orm.query(
        options,
        "SELECT CODPAR FROM PARAMETRI WHERE CODPAR IN (?, ?)",
        [this.versionParameterKeys[0], this.versionParameterKeys[1]]
      )) as any[];

      if (existingRows.length === 0) {
        await Orm.execute(
          options,
          "INSERT INTO PARAMETRI (CODPAR, DESPAR, NOTE, GRUPPO) VALUES (?, ?, ?, ?)",
          [this.versionParameterKeys[0], version, "versione", null]
        );
        return;
      }

      for (const row of existingRows) {
        await Orm.execute(options, "UPDATE PARAMETRI SET DESPAR = ? WHERE CODPAR = ?", [
          version,
          row.CODPAR?.trim?.() ?? row.CODPAR,
        ]);
      }
    } catch (error: any) {
      this.logger.error(`Error setting database version:`, error);
      throw error;
    }
  }
  //#endregion

  //#region Initialization Methods
  /**
   * Ensures the PARAMETRI table exists and initializes it if necessary.
   * @param options Database connection options.
   */
  protected static async createParametersTable(options: Options): Promise<void> {
    try {
      const tableAlreadyExists = await this.tableExists(options, "PARAMETRI");
      if (!tableAlreadyExists) {
        const createTableQuery = `
          CREATE TABLE PARAMETRI (
            CODPAR  VARCHAR(15) NOT NULL,
            DESPAR  VARCHAR(255),
            NOTE    BLOB SUB_TYPE 1 SEGMENT SIZE 80,
            GRUPPO  VARCHAR(20)
          );`;

        await Orm.query(options, createTableQuery);

        await Orm.query(
          options,
          "ALTER TABLE PARAMETRI ADD CONSTRAINT PK_PARAMETRI PRIMARY KEY (CODPAR);"
        );

        await Orm.query(options, "GRANT ALL ON PARAMETRI TO PUBLIC;");
        await Orm.query(options, "GRANT SELECT ON PARAMETRI TO TABX;");
      }

      const versioneDb = await this.getDatabaseVersion(options);
      if (versioneDb !== null && versioneDb !== undefined) {
        return;
      }

      await Orm.execute(
        options,
        "INSERT INTO PARAMETRI (CODPAR, DESPAR, NOTE, GRUPPO) VALUES (?,?,?,?)",
        [this.versionParameterKeys[0], "0.0a", "versione", null]
      );
    } catch (error: any) {
      this.logger.error("Error creating table PARAMETRI:", error);
      throw error;
    }


  }
  //#endregion
}
