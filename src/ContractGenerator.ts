import { jsPDF } from "jspdf";
import autotable, { Styles, UserOptions } from "jspdf-autotable";
import { promises as fs } from 'fs';
import path from 'path';

export interface IPartiContratto {
    fornitore: { denominazione: string; codiceFiscale: string; indirizzoCompleto: string; };
    cliente: { denominazione: string; codiceFiscale: string; indirizzoCompleto: string; };
}

export interface DocumentParams {
    parti: IPartiContratto;
    tipOutput?: 'f' | 'd' | 'u';
    dynamicFields?: { [key: string]: string };
    dynamicElements?: { [placeholder: string]: DynamicElement };
}

export type DynamicElement = {
    type: 'table';
    config: {
        head: string[];
        body: string[][];
        options?: UserOptions;
        styles?: Partial<Styles>;
    };
};

interface DocumentConfig {
    fontTitolo: { nome: string; dimensione: number; colore: string; installPath?: string; };
    fontSottotitolo: { nome: string; dimensione: number; colore: string; installPath?: string; };
    fontTesto: { nome: string; dimensione: number; colore: string; installPath?: string; };
    fontBold: { nome: string; dimensione: number; colore: string; installPath?: string; };
    margini: { sx: number; dx: number; alto: number; basso: number; };
    staccoriga: number;
    rientro: number;
    testi: {
        titolo: string;
        premessa: string;
        Punti: Array<{ titolo: string; Sottopunti: Array<{ titolo: string; contenuto: string; }>; }>;
        versione: string;
    };
    immagini: Array<{ path: string; posizione: [number, number]; dimensioni: [number, number]; coeffDim?: number; }>;
    box: { backgrund: string; raggio: number; };
    tableStyle?: { lineColor?: string; lineWidth?: number; font?: string; fontSize?: number; cellPadding?: number; fillColor?: string; };
}

async function loadImageAsBase64(imagePath: string): Promise<string> {
    const absolutePath = path.resolve(imagePath);
    const buffer = await fs.readFile(absolutePath);
    const ext = path.extname(imagePath).slice(1).toLowerCase();
    const base64 = buffer.toString('base64');
    return `data:image/${ext};base64,${base64}`;
}

export class DocumentGenerator {
    private config!: DocumentConfig;
    private doc!: jsPDF;
    private curX: number = 0;
    private curY: number = 0;
    private configLoaded: boolean = false;

    constructor(private configPath?: string) { }

    public setConfig(config: DocumentConfig) {
        this.config = config;
        this.configLoaded = true;
    }

    private applyTemplate(template: string, dynamicFields?: { [key: string]: string }): string {
        if (!dynamicFields) return template;
        return template.replace(/\$(\w+)\$/g, (match, key) =>
            dynamicFields[key] !== undefined ? dynamicFields[key] : match
        );
    }

    private applyPartiPlaceholders(text: string, parti: IPartiContratto): string {
        return text.replace(/\$(fornitore|cliente):(\w+)\$/g, (match: string, party: string, field: string) => {
            const partyData = (parti as unknown as Record<string, Record<string, string> | undefined>)[party];
            const value = partyData?.[field];
            return value ?? match;
        });
    }

    private async loadConfig(): Promise<void> {
        if (this.configLoaded) return;
        if (!this.configPath) throw new Error("No configuration provided.");
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(data) as DocumentConfig;
            this.configLoaded = true;
        } catch (error) {
            throw new Error(`Error reading configuration file: ${error}`);
        }
    }

    private initDoc(): void {
        this.doc = new jsPDF();
        const margins = this.config.margini;
        this.curX = margins.sx;
        this.curY = margins.alto;
    }

    private extractPlaceholder(text: string): string | null {
        const match = text.match(/^\$(\w+)\$$/);
        return match ? (match[1] ?? null) : null;
    }

    private async installFont(fontPath: string, fontName: string): Promise<void> {
        const absolutePath = path.resolve(fontPath);
        const buffer = await fs.readFile(absolutePath);
        const base64Font = buffer.toString('base64');
        //console.log(`Installing font ${fontName} from ${absolutePath}`);
        this.doc.addFileToVFS(`${fontName}.ttf`, base64Font);
        this.doc.addFont(`${fontName}.ttf`, fontName, 'normal');
        this.doc.setFont(fontName);
    }

    // Writes wrapped text, handling inline bold segments.
    private async writeWrappedTextCore(
        fontName: string,
        fontSize: number,
        color: string,
        text: string,
        x: number,
        y: number,
        maxWidth: number,
        lineSpacingFactor: number = 1.15
    ): Promise<number> {
        this.doc.setFont(fontName);
        this.doc.setFontSize(fontSize);
        this.doc.setTextColor(color);
        const lines = this.doc.splitTextToSize(text, maxWidth);
        const lineHeight = (fontSize * lineSpacingFactor / 72) * 25.4;
        for (const line of lines) {
            if (y + lineHeight > (this.doc.internal.pageSize.getHeight() - this.config.margini.basso)) {
                this.doc.addPage();
                y = this.config.margini.alto;
            }
            // If the line contains inline bold markers, process them.
            if (line.includes("**")) {
                y = await this.writeLineWithInlineBold(line, x, y, fontName, fontSize, color, maxWidth, lineSpacingFactor);
            } else {
                this.doc.text(line, x, y);
                y += lineHeight;
            }
        }
        return y;
    }

    // Writes a single line with inline bold processing.
    private async writeLineWithInlineBold(
        line: string,
        x: number,
        y: number,
        normalFont: string,
        fontSize: number,
        color: string,
        _maxWidth: number,
        lineSpacingFactor: number = 1.15
    ): Promise<number> {
        let currentX = x;
        // Split the line by bold segments. The regex keeps the markers.
        const segments = line.split(/(\*\*.*?\*\*)/);
        const lineHeight = (fontSize * lineSpacingFactor / 72) * 25.4;
        for (const seg of segments) {
            let segText = seg;
            let useBold = false;
            if (seg.startsWith("**") && seg.endsWith("**")) {
                useBold = true;
                segText = seg.substring(2, seg.length - 2);
            }
            if (useBold) {
                this.doc.setFont(this.config.fontBold.nome);
            } else {
                this.doc.setFont(normalFont);
            }
            this.doc.setFontSize(fontSize);
            this.doc.setTextColor(color);
            const segWidth = this.doc.getTextWidth(segText);
            // Write segment
            this.doc.text(segText, currentX, y);
            currentX += segWidth;
        }
        return y + lineHeight;
    }

    private async writeWrappedTextWithFont(
        fontConf: { nome: string; dimensione: number; colore: string; installPath?: string },
        text: string,
        x: number,
        y: number,
        maxWidth: number,
        lineSpacingFactor: number = 1.15
    ): Promise<void> {
        const fontList = this.doc.getFontList();
        if (!fontList[fontConf.nome]) {
            if (fontConf.installPath) await this.installFont(fontConf.installPath, fontConf.nome);
            else throw new Error("Font not present and no installPath provided");
        } else {
            this.doc.setFont(fontConf.nome);
        }
        this.curY = await this.writeWrappedTextCore(fontConf.nome, fontConf.dimensione, fontConf.colore, text, x, y, maxWidth, lineSpacingFactor);
    }

    public async writeBoxedText(
        text: string,
        fontConf: { nome: string; dimensione: number; colore: string; installPath?: string },
        padding: number = 5,
        borderRadius: number = 5,
        borderWidth: number = 1,
        boxColor?: string
    ): Promise<void> {
        const fontList = this.doc.getFontList();
        if (!fontList[fontConf.nome]) {
            if (fontConf.installPath) await this.installFont(fontConf.installPath, fontConf.nome);
            else throw new Error("Font not present and no installPath provided");
        } else {
            this.doc.setFont(fontConf.nome);
        }
        this.doc.setFontSize(fontConf.dimensione);
        this.doc.setTextColor(fontConf.colore);
        const pageWidth = this.doc.internal.pageSize.getWidth();
        const maxTextWidth = pageWidth - this.config.margini.sx - this.config.margini.dx - 2 * padding;
        const lines = this.doc.splitTextToSize(text, maxTextWidth);
        const lineHeight = (fontConf.dimensione * 1.15 / 72) * 25.4;
        const textHeight = lines.length * lineHeight;
        const boxX = this.curX;
        const boxY = this.curY;
        const boxWidth = maxTextWidth + 2 * padding;
        const boxHeight = textHeight + 2 * padding;
        if (boxColor) {
            this.doc.setFillColor(boxColor);
            this.doc.roundedRect(boxX, boxY, boxWidth, boxHeight, borderRadius, borderRadius, "F");
        }
        this.doc.setLineWidth(borderWidth);
        this.doc.roundedRect(boxX, boxY, boxWidth, boxHeight, borderRadius, borderRadius);
        const textX = boxX + padding;
        let textY = boxY + padding + lineHeight;
        for (const line of lines) {
            if (line.includes("**")) {
                textY = await this.writeLineWithInlineBold(line, textX, textY, fontConf.nome, fontConf.dimensione, fontConf.colore, maxTextWidth, 1.15);
            } else {
                this.doc.text(line, textX, textY);
                textY += lineHeight;
            }
        }
        this.curY = boxY + boxHeight + this.config.staccoriga;
    }


    // Checks if text is wrapped in '^' markers for boxed text.
    private isBoxedText(text: string): boolean {
        return text.startsWith('^') && text.endsWith('^');
    }

    // Removes '^' markers.
    private stripBoxMarkers(text: string): string {
        return text.substring(1, text.length - 1);
    }

    // Checks if text is entirely wrapped in '**' markers (not inline).
    // (This function is kept for backward compatibility.)
    private isBoldText(text: string): boolean {
        return text.startsWith('**') && text.endsWith('**');
    }

    // Removes '**' markers.
    private stripBoldMarkers(text: string): string {
        return text.substring(2, text.length - 2);
    }

    // Inserts images using the current cursor position.
    private async insertLogo(): Promise<void> {
        if (this.config.immagini && this.config.immagini.length > 0) {
            const startX = this.curX;
            for (const imgConf of this.config.immagini) {
                const format = imgConf.path.split('.').pop()?.toUpperCase() || 'PNG';
                const base64Image = await loadImageAsBase64(imgConf.path);
                const startY = this.curY;
                if (startY + imgConf.dimensioni[1] > (this.doc.internal.pageSize.getHeight() - this.config.margini.basso)) {
                    this.doc.addPage();
                    this.curY = this.config.margini.alto;
                }
                this.doc.addImage(base64Image, format, startX, this.curY, imgConf.dimensioni[0], imgConf.dimensioni[1]);
                //console.log(`Image inserted at X: ${startX}, Y: ${this.curY}`);
                this.curY = this.curY + imgConf.dimensioni[1] + this.config.staccoriga;
            }
        }
    }

    // Generates the PDF document by processing images, dynamic fields, tables, and text.
    // Supports inline bold formatting and boxed text.
    public async generateDocument(params: DocumentParams): Promise<string | ArrayBuffer> {
        await this.loadConfig();
        this.initDoc();
        await this.insertLogo();
        const dynamicFields = params.dynamicFields || {};
        const dynamicElements = params.dynamicElements || {};
        const pageWidth = this.doc.internal.pageSize.getWidth();
        const maxWidth = pageWidth - (this.config.margini.sx + this.config.margini.dx);
        let titolo = this.applyTemplate(this.config.testi.titolo, dynamicFields);
        titolo = this.applyPartiPlaceholders(titolo, params.parti);
        await this.writeWrappedTextWithFont(this.config.fontTitolo, titolo, this.curX, this.curY, maxWidth);
        this.curY += this.config.staccoriga;
        let premessa = this.applyTemplate(this.config.testi.premessa, dynamicFields);
        premessa = this.applyPartiPlaceholders(premessa, params.parti);
        await this.writeWrappedTextWithFont(this.config.fontTesto, premessa, this.curX, this.curY, maxWidth);
        this.curY += this.config.staccoriga;
        for (const punto of this.config.testi.Punti) {
            let puntoTitolo = this.applyTemplate(punto.titolo, dynamicFields);
            puntoTitolo = this.applyPartiPlaceholders(puntoTitolo, params.parti);
            await this.writeWrappedTextWithFont(this.config.fontTitolo, puntoTitolo, this.curX, this.curY, maxWidth);
            this.curY += this.config.staccoriga;
            for (const sub of punto.Sottopunti) {
                const placeholder = this.extractPlaceholder(sub.titolo);
                if (placeholder && dynamicElements[placeholder] && dynamicElements[placeholder].type === 'table' && dynamicElements[placeholder].config) {
                    const tableConfig = dynamicElements[placeholder].config!;
                    const defaultTableOptions = this.config.tableStyle || {};
                    autotable(this.doc, {
                        startY: this.curY,
                        head: [tableConfig.head],
                        body: tableConfig.body,
                        ...defaultTableOptions,
                        ...tableConfig.options,
                        ...tableConfig.styles
                    });
                    this.curY = ((this.doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + this.config.staccoriga;
                } else {
                    if (sub.titolo) {
                        let titleText = this.applyTemplate(sub.titolo, dynamicFields);
                        titleText = this.applyPartiPlaceholders(titleText, params.parti);
                        if (this.isBoxedText(titleText)) {
                            const boxText = this.stripBoxMarkers(titleText);
                            await this.writeBoxedText(boxText, this.config.fontSottotitolo);
                        } else if (this.isBoldText(titleText)) {
                            const boldText = this.stripBoldMarkers(titleText);

                            await this.writeWrappedTextWithFont({ ...this.config.fontSottotitolo, nome: this.config.fontSottotitolo.nome },
                                boldText, this.curX + this.config.rientro, this.curY, maxWidth - this.config.rientro);
                        } else {
                            await this.writeWrappedTextWithFont(this.config.fontSottotitolo, titleText, this.curX + this.config.rientro, this.curY, maxWidth - this.config.rientro);
                        }
                        this.curY += this.config.staccoriga;
                    }
                }
                const contentPlaceholder = this.extractPlaceholder(sub.contenuto);
                if (contentPlaceholder && dynamicElements[contentPlaceholder] && dynamicElements[contentPlaceholder].type === 'table' && dynamicElements[contentPlaceholder].config) {
                    const tableConfig = dynamicElements[contentPlaceholder].config!;
                    const defaultTableOptions = this.config.tableStyle || {};
                    autotable(this.doc, {
                        startY: this.curY,
                        head: [tableConfig.head],
                        body: tableConfig.body,
                        ...defaultTableOptions,
                        ...tableConfig.options,
                        ...tableConfig.styles
                    });
                    this.curY = ((this.doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + this.config.staccoriga;
                } else if (sub.contenuto) {
                    let contenuto = this.applyTemplate(sub.contenuto, dynamicFields);
                    contenuto = this.applyPartiPlaceholders(contenuto, params.parti);
                    if (this.isBoxedText(contenuto)) {
                        const boxText = this.stripBoxMarkers(contenuto);
                        await this.writeBoxedText(boxText, this.config.fontTesto);
                    } else if (this.isBoldText(contenuto)) {
                        const boldText = this.stripBoldMarkers(contenuto);
                        await this.writeWrappedTextWithFont({ ...this.config.fontTesto, nome: this.config.fontTesto.nome },
                            boldText, this.curX + this.config.rientro, this.curY, maxWidth - this.config.rientro);
                    } else {
                        await this.writeWrappedTextWithFont(this.config.fontTesto, contenuto, this.curX + this.config.rientro, this.curY, maxWidth - this.config.rientro);
                    }
                    this.curY += this.config.staccoriga;
                }
            }
            this.curY += this.config.staccoriga;
        }
        const tipOutput = params.tipOutput || 'd';
        // Sanitizza il nome: evita path traversal e caratteri non validi nel filesystem.
        const safeDenominazione = params.parti.cliente.denominazione
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\.+$/, '')
            .trim() || 'cliente';
        const fileName = `Documento_${safeDenominazione}.pdf`;
        if (tipOutput === 'd') {
            const pdfBuffer = this.doc.output('arraybuffer');
            await fs.writeFile(fileName, Buffer.from(pdfBuffer));
            return fileName;
        } else if (tipOutput === 'u') {
            return this.doc.output('arraybuffer');
        } else {
            return this.doc.output('arraybuffer');
        }
    }
}
