import { Inject, Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from "@nestjs/common";
import { autobind } from "../../../autobind";
import { Orm } from "../../../Orm";
import { AllegatiOptions } from "../../AllegatiModule";
import { UploadAllegatoResponseDto, DownloadAllegatoResponseDto, AllegatoDto} from "../../Dtos";
import { UploadSingleFileRequest } from "../../Dtos/UploadSingleFileRequest";

export class AllegatiError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 500
    ) {
        super(message);
        this.name = 'AllegatiError';
    }
}

@autobind
@Injectable()
export class AllegatiService {
    private readonly MAX_FILE_SIZE = 90 * 1024 * 1024; // 90MB
    private readonly ALLOWED_MIME_TYPES = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    constructor(@Inject('ALLEGATI_OPTIONS') private readonly allegatiOptions: AllegatiOptions) {
        this.ensureTableExists().catch(error => {
            console.error('[AllegatiService] Errore creazione tabella ALLEGATI:', error);
           // throw new InternalServerErrorException('Errore durante l\'inizializzazione del servizio allegati');
        });
    }

    private toAllegatoDto(row: Record<string, unknown>): AllegatoDto {
        const optionalString = (value: unknown): string | undefined => value === undefined || value === null ? undefined : String(value);
        const optionalNumber = (value: unknown): number | undefined => value === undefined || value === null ? undefined : Number(value);

        return {
            id: Number(row.ID ?? row.id),
            filename: String(row.FILENAME ?? row.filename ?? ''),
            mimetype: String(row.MIMETYPE ?? row.mimetype ?? ''),
            uploadDate: String(row.UPLOADDATE ?? row.uploadDate ?? ''),
            codice: optionalString(row.CODICE ?? row.codice),
            tipoCodice: optionalString(row.TIPOCODICE ?? row.tipoCodice),
            ordine: optionalString(row.ORDINE ?? row.ordine),
            descrizioneAllegato: optionalString(row.DESCRIZIONEALLEGATO ?? row.descrizioneAllegato),
            dataInizioValidita: optionalString(row.DATAINIZIOVALIDITA ?? row.dataInizioValidita),
            dataFineValidita: optionalString(row.DATAFINEVALIDITA ?? row.dataFineValidita),
            idTipoAllegato: optionalNumber(row.IDTIPOALLEGATO ?? row.idTipoAllegato),
            riferimentoDocumento: optionalString(row.RIFERIMENTODOCUMENTO ?? row.riferimentoDocumento),
        };
    }

    private validateFile(file: Express.Multer.File): void {
        if (!file) {
            throw new BadRequestException('Nessun file fornito');
        }

        if (file.size > this.MAX_FILE_SIZE) {
            throw new BadRequestException(`File troppo grande. Dimensione massima consentita: ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`);
        }

        if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            throw new BadRequestException(`Tipo di file non consentito. Tipi consentiti: ${this.ALLOWED_MIME_TYPES.join(', ')}`);
        }

        // Il mimetype dichiarato dal client e falsificabile: verifica i magic byte reali.
        if (!this.hasValidSignature(file)) {
            throw new BadRequestException('Il contenuto del file non corrisponde al tipo dichiarato.');
        }
    }

    private hasValidSignature(file: Express.Multer.File): boolean {
        const buffer = file?.buffer;
        if (!buffer || buffer.length < 4) {
            return false;
        }

        const startsWith = (...bytes: number[]): boolean => bytes.every((byte, index) => buffer[index] === byte);

        switch (file.mimetype) {
            case 'application/pdf':
                return startsWith(0x25, 0x50, 0x44, 0x46);
            case 'image/jpeg':
                return startsWith(0xff, 0xd8, 0xff);
            case 'image/png':
                return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
            case 'application/msword':
            case 'application/vnd.ms-excel':
                return startsWith(0xd0, 0xcf, 0x11, 0xe0);
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                // DOCX/XLSX sono archivi ZIP.
                return startsWith(0x50, 0x4b, 0x03, 0x04)
                    || startsWith(0x50, 0x4b, 0x05, 0x06)
                    || startsWith(0x50, 0x4b, 0x07, 0x08);
            default:
                return false;
        }
    }

    private sanitizeFilename(name: unknown): string {
        const raw = typeof name === 'string' ? name : '';
        const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
        const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
        return cleaned.slice(0, 255) || 'allegato';
    }


    async getAttachmentTypes(): Promise<Array<Record<string, unknown>>> {
        try {
            const query = `SELECT IDXTIPOALL as id, DESCRIZIONE as description FROM TIPOALL`;
            const results = await Orm.query(this.allegatiOptions.databaseOptions, query);
            
            if (!results) {
                throw new InternalServerErrorException('Errore durante il recupero dei tipi di allegato');
            }

            return results;
        } catch (error) {
            console.error('[AllegatiService] getAttachmentTypes - Errore:', error);
            if (error instanceof InternalServerErrorException) {
                throw error;
            }
            throw new InternalServerErrorException('Errore durante il recupero dei tipi di allegato');
        }
    }
    async uploadFile(file: Express.Multer.File, uploadSingleFileRequest: UploadSingleFileRequest): Promise<UploadAllegatoResponseDto> {
        try {
            this.validateFile(file);

            // Convert buffer to base64 in chunks to avoid memory issues
            const chunkSize = 1024 * 1024; // 1MB chunks
            let base64Content = '';
            for (let i = 0; i < file.buffer.length; i += chunkSize) {
                const chunk = file.buffer.slice(i, i + chunkSize);
                base64Content += chunk.toString('base64');
            }

            const insertQuery = `
                INSERT INTO ALLEGATI (
                    CODICE, TIPCOD, ORDINE, DESALL, NOMEFILE,
                    DADATAVAL, ADATAVAL, ALLEGATO, IDXTIPOALL, DATMODIF, DOCRIF
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                RETURNING IDXALL
            `;

            const params = [
                uploadSingleFileRequest.codice,
                uploadSingleFileRequest.tipoCodice,
                uploadSingleFileRequest.ordine,
                uploadSingleFileRequest.descrizioneAllegato,
                this.sanitizeFilename(file.originalname),
                uploadSingleFileRequest.dataInizioValidita,
                uploadSingleFileRequest.dataFineValidita,
                base64Content,
                uploadSingleFileRequest.idTipoAllegato,
                uploadSingleFileRequest.riferimentoDocumento
            ];

            const result = await Orm.query(this.allegatiOptions.databaseOptions, insertQuery, params);
            // node-firebird restituisce le righe di INSERT ... RETURNING come array; il fallback
            // copre le versioni/driver che restituiscono un singolo oggetto.
            const inserted = (Array.isArray(result) ? result[0] : result) as Record<string, unknown> | undefined;
            const insertedId = inserted?.IDXALL ?? inserted?.idxall;

            if (insertedId === undefined || insertedId === null) {
                throw new InternalServerErrorException('Errore durante il salvataggio del file');
            }

            return {
                id: Number(insertedId),
                filename: this.sanitizeFilename(file.originalname),
            };
        } catch (error) {
            console.error('[AllegatiService] uploadFile - Errore:', error);
            if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
                throw error;
            }
            throw new InternalServerErrorException('Errore durante il caricamento del file');
        }
    }

    async ensureTableExists(): Promise<void> {
        try {
            const query = `
                SELECT RDB$RELATION_NAME 
                FROM RDB$RELATIONS 
                WHERE RDB$RELATION_NAME = 'ALLEGATI'
            `;
            const result = await Orm.query(this.allegatiOptions.databaseOptions, query);
            
            if (!result || result.length === 0) {
                throw new Error('Tabella ALLEGATI non trovata nel database');
            }
        } catch (error) {
            console.error('[AllegatiService] Errore verifica tabella ALLEGATI:', error);
            throw new InternalServerErrorException('Errore durante la verifica della tabella ALLEGATI');
        }
    }

    async downloadFile(id: number): Promise<DownloadAllegatoResponseDto> {
        try {
            if (!id || id <= 0) {
                throw new BadRequestException('ID allegato non valido');
            }

            const query = `
                SELECT 
                    ALLEGATO as content,
                    NOMEFILE as filename,
                    IDXTIPOALL as idTipoAllegato
                FROM ALLEGATI 
                WHERE IDXALL = ?
            `;
            
            const results = await Orm.query(this.allegatiOptions.databaseOptions, query, [id]);
            
            if (!results || results.length === 0) {
                throw new NotFoundException(`Allegato con ID ${id} non trovato`);
            }

            const result = results[0];
            const content = result?.CONTENT ?? result?.content;
            const filename = result?.FILENAME ?? result?.filename;

            if (typeof content !== 'string' || content.length === 0) {
                throw new InternalServerErrorException('Contenuto file non disponibile');
            }

            if (typeof filename !== 'string' || filename.length === 0) {
                throw new InternalServerErrorException('Nome file non disponibile');
            }

            const mimetype = this.detectMimeType(filename);
            
            return {
                contentBase64: content,
                filename,
                mimetype
            };
        } catch (error) {
            console.error('[AllegatiService] downloadFile - Errore:', error);
            if (error instanceof BadRequestException || 
                error instanceof NotFoundException || 
                error instanceof InternalServerErrorException) {
                throw error;
            }
            throw new InternalServerErrorException('Errore durante il download del file');
        }
    }

    private detectMimeType(filename: string): string {
        const extension = filename.split('.').pop()?.toLowerCase();
        const mimeTypes: { [key: string]: string } = {
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
        return mimeTypes[extension || ''] || 'application/octet-stream';
    }

    async deleteFile(id: number): Promise<void> {
        try {
            if (!id || id <= 0) {
                throw new BadRequestException('ID allegato non valido');
            }

            const checkQuery = `SELECT IDXALL FROM ALLEGATI WHERE IDXALL = ?`;
            const checkResult = await Orm.query(this.allegatiOptions.databaseOptions, checkQuery, [id]);
            
            if (!checkResult || checkResult.length === 0) {
                throw new NotFoundException(`Allegato con ID ${id} non trovato`);
            }

            const query = `DELETE FROM ALLEGATI WHERE IDXALL = ?`;
            await Orm.execute(this.allegatiOptions.databaseOptions, query, [id]);
            
           
        } catch (error) {
            console.error('[AllegatiService] deleteFile - Errore:', error);
            if (error instanceof BadRequestException || 
                error instanceof NotFoundException || 
                error instanceof InternalServerErrorException) {
                throw error;
            }
            throw new InternalServerErrorException('Errore durante la cancellazione del file');
        }
    }

    async listFiles(filters?: { 
        tipcod?: string;
        codice?: number;
        docrif?: string;
        idxtipoall?: number;
    }): Promise<AllegatoDto[]> {
        try {
            const whereConditions: string[] = [];
            const params: unknown[] = [];

            if (filters) {
                if (filters.tipcod) {
                    whereConditions.push('TIPCOD = ?');
                    params.push(filters.tipcod);
                }
                if (filters.codice) {
                    whereConditions.push('CODICE = ?');
                    params.push(filters.codice);
                }
                if (filters.docrif) {
                    whereConditions.push('DOCRIF = ?');
                    params.push(filters.docrif);
                }
                if (filters.idxtipoall !== undefined) {
                    whereConditions.push('IDXTIPOALL = ?');
                    params.push(filters.idxtipoall);
                }
            }

            const query = `
                SELECT 
                    IDXALL as id,
                    NOMEFILE as filename,
                    'application/octet-stream' as mimetype,
                    DATMODIF as uploadDate,
                    CODICE as codice,
                    TIPCOD as tipoCodice,
                    ORDINE as ordine,
                    DESALL as descrizioneAllegato,
                    DADATAVAL as dataInizioValidita,
                    ADATAVAL as dataFineValidita,
                    IDXTIPOALL as idTipoAllegato,
                    DOCRIF as riferimentoDocumento
                FROM ALLEGATI
                ${whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''}
            `;

            const results = await Orm.query(this.allegatiOptions.databaseOptions, query, params);
            
            if (!results) {
                throw new InternalServerErrorException('Errore durante il recupero della lista dei file');
            }

            return results.map((r: Record<string, unknown>) => this.toAllegatoDto(r));
        } catch (error) {
            console.error('[AllegatiService] listFiles - Errore:', error);
            if (error instanceof InternalServerErrorException) {
                throw error;
            }
            throw new InternalServerErrorException('Errore durante il recupero della lista dei file');
        }
    }

    /**
     * Find allegati by a combination of tipcod, codice, docrif, idxtipoall
     */
    async findByFields(fields: { tipcod?: string; codice?: number; docrif?: string; idxtipoall?: number }): Promise<AllegatoDto[]> {
        try {
            const whereConditions: string[] = [];
            const params: unknown[] = [];
            if (fields.tipcod) {
                whereConditions.push('TIPCOD = ?');
                params.push(fields.tipcod);
            }
            if (fields.codice) {
                whereConditions.push('CODICE = ?');
                params.push(fields.codice);
            }
            if (fields.docrif) {
                whereConditions.push('DOCRIF = ?');
                params.push(fields.docrif);
            }
            if (fields.idxtipoall !== undefined) {
                whereConditions.push('IDXTIPOALL = ?');
                params.push(fields.idxtipoall);
            }
            const query = `
                SELECT 
                    IDXALL as id,
                    NOMEFILE as filename,
                    'application/octet-stream' as mimetype,
                    DATMODIF as uploadDate,
                    CODICE as codice,
                    TIPCOD as tipoCodice,
                    ORDINE as ordine,
                    DESALL as descrizioneAllegato,
                    DADATAVAL as dataInizioValidita,
                    ADATAVAL as dataFineValidita,
                    IDXTIPOALL as idTipoAllegato,
                    DOCRIF as riferimentoDocumento
                FROM ALLEGATI
                ${whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''}
            `;
            const results = await Orm.query(this.allegatiOptions.databaseOptions, query, params);
            if (!results) {
                throw new InternalServerErrorException('Errore durante la ricerca degli allegati');
            }
            return results.map((r: Record<string, unknown>) => this.toAllegatoDto(r));
        } catch (error) {
            console.error('[AllegatiService] findByFields - Errore:', error);
            throw new InternalServerErrorException('Errore durante la ricerca degli allegati');
        }
    }

    /**
     * Update tipcod, codice, docrif, idxtipoall for a given allegato by id
     */
    async updateFieldsById(id: number, fields: { tipcod?: string; codice?: number; docrif?: string; idxtipoall?: number }): Promise<void> {
        try {
            if (!id || id <= 0) {
                throw new BadRequestException('ID allegato non valido');
            }
            const updates: string[] = [];
            const params: unknown[] = [];
            if (fields.tipcod !== undefined) {
                updates.push('TIPCOD = ?');
                params.push(fields.tipcod);
            }
            if (fields.codice !== undefined) {
                updates.push('CODICE = ?');
                params.push(fields.codice);
            }
            if (fields.docrif !== undefined) {
                updates.push('DOCRIF = ?');
                params.push(fields.docrif);
            }
            if (fields.idxtipoall !== undefined) {
                updates.push('IDXTIPOALL = ?');
                params.push(fields.idxtipoall);
            }
            if (updates.length === 0) {
                throw new BadRequestException('Nessun campo da aggiornare');
            }
            const query = `UPDATE ALLEGATI SET ${updates.join(', ')} WHERE IDXALL = ?`;
            params.push(id);
            const result = await Orm.execute(this.allegatiOptions.databaseOptions, query, params);
            if (!result) {
                throw new InternalServerErrorException('Errore durante l\'aggiornamento del file');
            }
        } catch (error) {
            console.error('[AllegatiService] updateFieldsById - Errore:', error);
            throw error;
        }
    }

    /**
     * Get a single allegato by fields (returns the first match)
     */
    async getOneByFields(fields: { tipcod?: string; codice?: number; docrif?: string; idxtipoall?: number }): Promise<AllegatoDto | null> {
        const results = await this.findByFields(fields);
        return results.length > 0 ? results[0] : null;
    }

}
