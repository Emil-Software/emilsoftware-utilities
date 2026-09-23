/**
 * Genera la Wiki in Markdown per GitHub a partire dalla stessa fonte usata
 * dalla console: `src/accessi-module/Console/wiki.ts`.
 *
 * Output:
 * - WIKI.md      documentazione completa con indice
 * - WIKI.ai.md   digest compatto pensato per l'IA
 *
 * La wiki della console e questi file non possono divergere: entrambi derivano
 * dagli stessi dati. Non modificare WIKI.md a mano, esegui `npm run generate:accessi-wiki`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIKI_SECTIONS, wikiGroups, buildAiDigest } from '../accessi-module/Console/wiki';
import type { WikiBlock, WikiTone } from '../accessi-module/Console/wiki';

const REPO_ROOT = join(__dirname, '..', '..');

/** Riproduce la slug dei titoli usata da GitHub per generare gli anchor. */
function githubSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

const ALERT: Record<WikiTone, string> = {
  info: 'NOTE',
  ok: 'TIP',
  warn: 'WARNING',
  danger: 'CAUTION',
};

function renderCode(block: Extract<WikiBlock, { kind: 'code' }>): string {
  const label = block.variant === 'good'
    ? `**Esempio corretto${block.title ? ` — ${block.title}` : ''}**`
    : block.variant === 'bad'
      ? `**Esempio da evitare${block.title ? ` — ${block.title}` : ''}**`
      : block.title
        ? `**${block.title}**`
        : '';
  const fence = '```' + block.language;
  return [...(label ? [label, ''] : []), fence, block.code, '```'].join('\n');
}

function renderBlock(block: WikiBlock): string {
  switch (block.kind) {
    case 'p':
      return block.text;
    case 'h':
      return `### ${block.text}`;
    case 'list':
      return block.items
        .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`)
        .join('\n');
    case 'code':
      return renderCode(block);
    case 'callout':
      return [
        `> [!${ALERT[block.tone]}]`,
        ...(block.title ? [`> **${block.title}**`] : []),
        `> ${block.text}`,
      ].join('\n');
    case 'table': {
      const head = `| ${block.head.join(' | ')} |`;
      const separator = `| ${block.head.map(() => '---').join(' | ')} |`;
      const rows = block.rows.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`);
      return [head, separator, ...rows].join('\n');
    }
    default:
      return '';
  }
}

function buildMarkdown(): string {
  const groups = wikiGroups();
  const toc = groups
    .map(({ group, sections }) => [
      `**${group}**`,
      '',
      ...sections.map((section) => `- [${section.title}](#${githubSlug(section.title)})`),
      '',
    ].join('\n'))
    .join('\n');

  const body = WIKI_SECTIONS
    .map((section) => [
      `## ${section.title}`,
      '',
      `_${section.summary}_`,
      '',
      section.blocks.map(renderBlock).join('\n\n'),
      '',
    ].join('\n'))
    .join('\n---\n\n');

  return [
    '# Wiki del modulo Accessi',
    '',
    '> Documento generato automaticamente da `src/accessi-module/Console/wiki.ts` (la stessa fonte della Wiki nella console).',
    '> Non modificarlo a mano: esegui `npm run generate:accessi-wiki`.',
    '',
    'La stessa documentazione e disponibile, resa in modo interattivo, nella console Accessi su `/api/accessi/console/wiki`.',
    'Per una versione compatta da fornire a un\'IA che costruisce il backend integratore, vedi [`WIKI.ai.md`](WIKI.ai.md).',
    '',
    '## Indice',
    '',
    toc,
    '---',
    '',
    body,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

const aiHeader = [
  '<!-- Documento generato automaticamente da src/accessi-module/Console/wiki.ts. Non modificare a mano: npm run generate:accessi-wiki. -->',
  '',
].join('\n');

writeFileSync(join(REPO_ROOT, 'WIKI.md'), buildMarkdown(), 'utf8');
writeFileSync(join(REPO_ROOT, 'WIKI.ai.md'), `${aiHeader}${buildAiDigest()}\n`, 'utf8');
process.stdout.write('Wiki generata: WIKI.md e WIKI.ai.md\n');
