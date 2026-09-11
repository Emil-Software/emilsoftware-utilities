# Revisione Accessi e logging

Il logger predefinito scrive in append su `logs/YYYY-MM-DD.json` (un oggetto JSON per riga). Il giorno segue il fuso locale del processo/server. Un timer crea il nuovo file alla mezzanotte anche senza traffico; ogni messaggio viene inoltre instradato secondo la propria data, compresi quelli accodati. Il riavvio conserva il contenuto del giorno. Sono supportate directory annidate e tutti i livelli pubblici del logger. I transport personalizzati restano sotto il controllo del chiamante. Non viene applicata cancellazione automatica dei file storici.

Correzioni Accessi:

- Guard Nest e middleware Express accettano soltanto lo schema Bearer; identificativi utente interi positivi e token di accesso vengono distinti da token di reset.
- I privilegi correnti sovrascrivono anche le claim legacy al primo livello. Gli errori database nel guard non vengono trasformati in credenziali errate.
- I grant dei ruoli sono combinati prendendo il livello massimo; i grant diretti conservano la precedenza, inclusa la negazione esplicita. I gruppi disabilitati sono esclusi dai menu e dai grant ereditati.
- Liste vuote di ruoli e permessi nell'aggiornamento amministrativo revocano le assegnazioni.
- Il codice utente dei filtri supera correttamente la validazione DTO. Il consenso GDPR viene registrato nello storico e nel profilo tramite SQL valido.
- Il reset password consuma il nonce e salva password/stato/scadenza nella stessa transazione; un errore annulla tutto. Il fallimento SMTP cancella soltanto il nonce della richiesta fallita.

Verifica ripetibile: `node --test test/accessi-regressions.cjs test/password-reset-regressions.cjs`. Le prove del database usano adapter simulati: non sostituiscono una verifica su un database Firebird di collaudo.
