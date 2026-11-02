/*
  Accessi database migration 1.1.6 -> 1.2.0.

  The same idempotent schema is applied automatically by AccessiDatabaseUpdater
  when autoUpdateDatabase=true. This file exists for DBA-managed deployments
  that apply database migrations manually before deploying the library.

  Existing users keep password login because UTENTI_CONFIG.FLGPASSWORD has
  default value 1. No tokens, secrets or external claims are stored.
*/

SET TERM ^ ;

EXECUTE BLOCK
AS
BEGIN
  IF (NOT EXISTS (
    SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'UTENTI_IDENTITA_EXT'
  )) THEN
    EXECUTE STATEMENT '
      CREATE TABLE UTENTI_IDENTITA_EXT (
        IDNKEY CHAR(64) CHARACTER SET ASCII NOT NULL,
        CODUTE INTEGER NOT NULL,
        PROVIDER VARCHAR(64) CHARACTER SET ASCII NOT NULL,
        SUBJECT VARCHAR(512) CHARACTER SET UTF8 NOT NULL,
        FLGATTIVO SMALLINT DEFAULT 1 NOT NULL,
        DATINS TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        DATLASTLOGIN TIMESTAMP,
        DATDISATT TIMESTAMP,
        NOTA VARCHAR(500) CHARACTER SET UTF8
      )';

  IF (NOT EXISTS (
    SELECT 1 FROM RDB$RELATION_CONSTRAINTS WHERE RDB$CONSTRAINT_NAME = 'PK_UTEIDEXT'
  )) THEN
    EXECUTE STATEMENT 'ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT PK_UTEIDEXT PRIMARY KEY (IDNKEY)';

  IF (NOT EXISTS (
    SELECT 1 FROM RDB$RELATION_CONSTRAINTS WHERE RDB$CONSTRAINT_NAME = 'FK_UTEIDEXT_UTENTE'
  )) THEN
    EXECUTE STATEMENT 'ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT FK_UTEIDEXT_UTENTE FOREIGN KEY (CODUTE) REFERENCES UTENTI (CODUTE) ON DELETE CASCADE';

  IF (NOT EXISTS (
    SELECT 1 FROM RDB$RELATION_CONSTRAINTS WHERE RDB$CONSTRAINT_NAME = 'CK_UTEIDEXT_ATTIVO'
  )) THEN
    EXECUTE STATEMENT 'ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT CK_UTEIDEXT_ATTIVO CHECK (FLGATTIVO IN (0, 1))';

  IF (NOT EXISTS (
    SELECT 1 FROM RDB$INDICES WHERE RDB$INDEX_NAME = 'IDX_UTEIDEXT_CODUTE'
  )) THEN
    EXECUTE STATEMENT 'CREATE INDEX IDX_UTEIDEXT_CODUTE ON UTENTI_IDENTITA_EXT (CODUTE)';

  IF (NOT EXISTS (
    SELECT 1 FROM RDB$RELATION_FIELDS
    WHERE RDB$RELATION_NAME = 'UTENTI_CONFIG' AND RDB$FIELD_NAME = 'FLGPASSWORD'
  )) THEN
    EXECUTE STATEMENT 'ALTER TABLE UTENTI_CONFIG ADD FLGPASSWORD SMALLINT DEFAULT 1 NOT NULL';
END^

SET TERM ; ^

COMMENT ON TABLE UTENTI_IDENTITA_EXT IS 'Associa identita esterne gia verificate dal backend agli utenti Accessi; non memorizza token, segreti o claim SSO.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.IDNKEY IS 'SHA-256 calcolato dalla libreria su provider e subject; chiave tecnica di lookup.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.CODUTE IS 'Codice dell utente Accessi proprietario dell identita esterna.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.PROVIDER IS 'Namespace stabile dichiarato dal backend, non configurazione o segreto del provider SSO.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.SUBJECT IS 'Identificativo opaco e stabile gia verificato dal backend presso il provider.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.FLGATTIVO IS '1 identita utilizzabile per login; 0 collegamento disabilitato logicamente.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.DATINS IS 'Istante di creazione del collegamento.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.DATLASTLOGIN IS 'Ultimo login SSO riuscito con questa identita.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.DATDISATT IS 'Istante di disabilitazione logica del collegamento.';
COMMENT ON COLUMN UTENTI_IDENTITA_EXT.NOTA IS 'Nota amministrativa opzionale; non memorizzare token o dati personali non necessari.';
COMMENT ON COLUMN UTENTI_CONFIG.FLGPASSWORD IS '1 consente login locale con password; 0 rende utente SSO-only. Default 1 preserva utenti esistenti.';
