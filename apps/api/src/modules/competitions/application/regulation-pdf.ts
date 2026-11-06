// Оформление фирменного положения в PDF (правки 05.11.2026, п. 8): логотип «Цифровое Самбо», фирменные цвета
// (тёмно-синий, синий и красный, как в логотипе), шрифты PT Serif (текст) и PT Sans Narrow (заголовки) с кириллицей.
// Титульный лист с грифами «СОГЛАСОВАНО» и «УТВЕРЖДАЮ», на остальных страницах — колонтитулы и нумерация.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { RegulationBlock, RegulationDocument } from '../domain/regulation-document';

const NAVY = '#131B2E';
const BLUE = '#2B4FA8';
const RED = '#C62F3E';
const MUTED = '#5B6475';
const RULE = '#D5DAE5';
const ZEBRA = '#F3F5FA';
const NOTE_BG = '#EEF2FB';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 82, bottom: 64, left: 68, right: 56 };

/** Каталог шрифтов и логотипа: apps/api/assets/regulation (и из src, и из dist — ищем вверх по дереву). */
function assetsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'assets', 'regulation');
    if (existsSync(path.join(candidate, 'logo.png'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('regulation assets not found');
}

const ASSETS = assetsDir();
const FONT = (file: string) => path.join(ASSETS, 'fonts', file);

/** Размер PNG из заголовка IHDR; путь строкой — pdfkit встраивает картинку один раз на весь документ. */
function png(file: string): { file: string; width: number; height: number } {
  const full = path.join(ASSETS, file);
  const head = readFileSync(full).subarray(16, 24);
  return { file: full, width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

const LOGO = png('logo.png');
const KNOT = png('logo-knot.png');

type Doc = PDFKit.PDFDocument;

export function renderRegulationPdf(d: RegulationDocument): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: 'A4',
    margins: MARGIN,
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `Положение — ${d.name}`,
      Author: 'Цифровое Самбо',
      Subject: 'Положение о проведении соревнования по самбо',
      Creator: 'Платформа «Цифровое Самбо»',
    },
    lang: 'ru-RU',
  });
  doc.registerFont('serif', FONT('PTSerif-Regular.ttf'));
  doc.registerFont('serif-bold', FONT('PTSerif-Bold.ttf'));
  doc.registerFont('sans', FONT('PTSans-Regular.ttf'));
  doc.registerFont('sans-bold', FONT('PTSans-Bold.ttf'));
  doc.registerFont('narrow', FONT('PTSansNarrow-Bold.ttf'));

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  titlePage(doc, d);
  doc.addPage();
  for (const section of d.sections) renderSection(doc, section.number, section.title, section.blocks);
  closing(doc, d);
  decorate(doc, d);
  doc.end();
  return done;
}

// ---------- Титульный лист ----------

function titlePage(doc: Doc, d: RegulationDocument): void {
  const contentWidth = PAGE.width - MARGIN.left - MARGIN.right;
  stripe(doc, 0, 0, PAGE.width, 10);

  // Грифы согласования и утверждения.
  const colWidth = contentWidth / 2 - 14;
  const top = 46;
  d.approvals.forEach((a, i) => {
    const x = MARGIN.left + i * (colWidth + 28);
    const align = i === 0 ? 'left' : 'right';
    doc
      .font('sans-bold')
      .fontSize(10)
      .fillColor(NAVY)
      .text(a.title, x, top, { width: colWidth, align, characterSpacing: 1.5 });
    let y = doc.y + 4;
    for (const line of a.lines) {
      doc
        .font('serif')
        .fontSize(9.5)
        .fillColor(line.startsWith('_') || line.startsWith('«') ? MUTED : NAVY);
      doc.text(line || ' ', x, y, { width: colWidth, align });
      y = doc.y + (line ? 2 : 6);
    }
  });

  // Логотип.
  const logoWidth = 196;
  doc.image(LOGO.file, (PAGE.width - logoWidth) / 2, 214, { width: logoWidth });

  let y = 214 + logoWidth * (LOGO.height / LOGO.width) + 34;
  doc.font('narrow').fontSize(34).fillColor(NAVY).text('ПОЛОЖЕНИЕ', MARGIN.left, y, {
    width: contentWidth,
    align: 'center',
    characterSpacing: 6,
  });
  y = doc.y + 2;
  doc
    .font('serif')
    .fontSize(13)
    .fillColor(MUTED)
    .text('о проведении спортивного соревнования по самбо', MARGIN.left, y, {
      width: contentWidth,
      align: 'center',
    });
  y = doc.y + 18;
  doc
    .font('narrow')
    .fontSize(21)
    .fillColor(BLUE)
    .text(d.name.toUpperCase(), MARGIN.left + 20, y, {
      width: contentWidth - 40,
      align: 'center',
      lineGap: 2,
    });
  y = doc.y + 16;
  divider(doc, PAGE.width / 2, y, 150);
  y += 18;
  doc
    .font('serif-bold')
    .fontSize(13)
    .fillColor(NAVY)
    .text(d.dateLine, MARGIN.left, y, { width: contentWidth, align: 'center' });
  if (d.placeLine) {
    doc.moveDown(0.3);
    doc
      .font('serif')
      .fontSize(11.5)
      .fillColor(NAVY)
      .text(d.placeLine, MARGIN.left + 30, doc.y, {
        width: contentWidth - 60,
        align: 'center',
      });
  }

  // Низ титульного листа — за нижним полем: без поля pdfkit не переносит текст на новую страницу.
  const saved = { ...doc.page.margins };
  doc.page.margins = { ...saved, bottom: 0 };
  const bottom = PAGE.height - 92;
  doc
    .font('sans')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text('Рейтинговый турнир платформы «Цифровое Самбо»', MARGIN.left, bottom, {
      width: contentWidth,
      align: 'center',
      lineBreak: false,
    });
  doc
    .font('narrow')
    .fontSize(13)
    .fillColor(NAVY)
    .text(d.cityYear, MARGIN.left, bottom + 16, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 1,
      lineBreak: false,
    });
  stripe(doc, 0, PAGE.height - 10, PAGE.width, 10);
  doc.page.margins = saved;
}

/** Фирменная полоса: синий и красный, как подчёркивание в логотипе. */
function stripe(doc: Doc, x: number, y: number, width: number, height: number): void {
  const split = x + width * 0.62;
  doc.save();
  doc.rect(x, y, split - x, height).fill(BLUE);
  doc.rect(split, y, x + width - split, height).fill(RED);
  doc.restore();
}

/** Короткий разделитель «синий — красный» со скосами, по центру `cx`. */
function divider(doc: Doc, cx: number, y: number, width: number): void {
  const h = 3.2;
  const gap = 8;
  const half = (width - gap) / 2;
  doc.save();
  doc
    .polygon(
      [cx - half - gap / 2, y + h],
      [cx - gap / 2, y + h],
      [cx - gap / 2 + 3, y],
      [cx - half - gap / 2 + 3, y],
    )
    .fill(BLUE);
  doc
    .polygon(
      [cx + gap / 2, y + h],
      [cx + half + gap / 2, y + h],
      [cx + half + gap / 2 + 3, y],
      [cx + gap / 2 + 3, y],
    )
    .fill(RED);
  doc.restore();
}

// ---------- Разделы ----------

const BODY_SIZE = 10.8;
const LINE_GAP = 2.2;

function contentWidth(): number {
  return PAGE.width - MARGIN.left - MARGIN.right;
}

function bottomLimit(): number {
  return PAGE.height - MARGIN.bottom;
}

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > bottomLimit()) doc.addPage();
}

function renderSection(doc: Doc, number: number, title: string, blocks: RegulationBlock[]): void {
  // Заголовок не остаётся в конце страницы без текста.
  ensureSpace(doc, 74);
  if (doc.y > MARGIN.top + 2) doc.y += 10;
  const y = doc.y;
  const badge = 20;
  doc.save();
  doc.roundedRect(MARGIN.left, y, badge, badge, 3).fill(BLUE);
  doc.restore();
  doc
    .font('narrow')
    .fontSize(12)
    .fillColor('#FFFFFF')
    .text(String(number), MARGIN.left, y + 3.2, {
      width: badge,
      align: 'center',
      lineBreak: false,
    });
  doc
    .font('narrow')
    .fontSize(14)
    .fillColor(NAVY)
    .text(title.toUpperCase(), MARGIN.left + badge + 10, y + 1.6, {
      width: contentWidth() - badge - 10,
      characterSpacing: 0.6,
    });
  const ruleY = Math.max(doc.y, y + badge) + 5;
  doc.save();
  doc
    .moveTo(MARGIN.left, ruleY)
    .lineTo(MARGIN.left + contentWidth(), ruleY)
    .lineWidth(0.6)
    .strokeColor(RULE)
    .stroke();
  doc.restore();
  doc.x = MARGIN.left;
  doc.y = ruleY + 9;
  for (const block of blocks) renderBlock(doc, block);
}

function renderBlock(doc: Doc, b: RegulationBlock): void {
  switch (b.kind) {
    case 'clause': {
      ensureSpace(doc, 30);
      doc.font('serif-bold').fontSize(BODY_SIZE).fillColor(BLUE).text(`${b.number} `, MARGIN.left, doc.y, {
        continued: true,
        width: contentWidth(),
        align: 'justify',
        lineGap: LINE_GAP,
      });
      doc.font('serif').fillColor(NAVY).text(b.text, { align: 'justify', lineGap: LINE_GAP });
      doc.y += 5;
      return;
    }
    case 'text': {
      doc.font('serif').fontSize(BODY_SIZE).fillColor(NAVY).text(b.text, MARGIN.left, doc.y, {
        width: contentWidth(),
        align: 'justify',
        lineGap: LINE_GAP,
      });
      doc.y += 5;
      return;
    }
    case 'bullets': {
      const indent = 20;
      for (const item of b.items) {
        ensureSpace(doc, 26);
        const y = doc.y;
        doc.save();
        doc.rect(MARGIN.left + 6, y + 5, 4, 4).fill(RED);
        doc.restore();
        doc
          .font('serif')
          .fontSize(BODY_SIZE)
          .fillColor(NAVY)
          .text(item, MARGIN.left + indent, y, {
            width: contentWidth() - indent,
            align: 'justify',
            lineGap: LINE_GAP,
          });
        doc.y += 2.5;
      }
      doc.x = MARGIN.left;
      doc.y += 4;
      return;
    }
    case 'note': {
      const pad = 9;
      const width = contentWidth();
      doc.font('sans').fontSize(9.6);
      const h = doc.heightOfString(b.text, { width: width - pad * 2 - 4, lineGap: 1.5 }) + pad * 2;
      ensureSpace(doc, h + 6);
      const y = doc.y + 2;
      doc.save();
      doc.rect(MARGIN.left, y, width, h).fill(NOTE_BG);
      doc.rect(MARGIN.left, y, 3, h).fill(BLUE);
      doc.restore();
      doc
        .font('sans')
        .fontSize(9.6)
        .fillColor(NAVY)
        .text(b.text, MARGIN.left + pad + 4, y + pad, {
          width: width - pad * 2 - 4,
          lineGap: 1.5,
        });
      doc.x = MARGIN.left;
      doc.y = y + h + 9;
      return;
    }
    case 'table':
      renderTable(doc, b);
      return;
  }
}

function renderTable(doc: Doc, t: Extract<RegulationBlock, { kind: 'table' }>): void {
  const width = contentWidth();
  const widths = t.widths.map((w) => w * width);
  const padX = 7;
  const padY = 5;
  const hasHeader = t.columns.some((c) => c.trim().length > 0);

  const cellHeight = (text: string, w: number, font: string, size: number) => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text || ' ', { width: w - padX * 2, lineGap: 1.2 });
  };

  const header = () => {
    if (!hasHeader) return;
    const h = Math.max(...t.columns.map((c, i) => cellHeight(c, widths[i] ?? 0, 'sans-bold', 9))) + padY * 2;
    const y = doc.y;
    doc.save();
    doc.rect(MARGIN.left, y, width, h).fill(NAVY);
    doc.restore();
    let x = MARGIN.left;
    t.columns.forEach((c, i) => {
      doc
        .font('sans-bold')
        .fontSize(9)
        .fillColor('#FFFFFF')
        .text(c, x + padX, y + padY, {
          width: (widths[i] ?? 0) - padX * 2,
          lineGap: 1.2,
        });
      x += widths[i] ?? 0;
    });
    doc.y = y + h;
  };

  ensureSpace(doc, 50);
  doc.y += 2;
  header();
  t.rows.forEach((row, r) => {
    const fontOf = (i: number) => (i === 0 && !hasHeader ? 'sans-bold' : 'sans');
    const h = Math.max(...row.map((c, i) => cellHeight(c, widths[i] ?? 0, fontOf(i), 9.6))) + padY * 2;
    if (doc.y + h > bottomLimit()) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    doc.save();
    if (r % 2 === 1 || !hasHeader) doc.rect(MARGIN.left, y, width, h).fill(r % 2 === 1 ? ZEBRA : '#FFFFFF');
    doc
      .moveTo(MARGIN.left, y + h)
      .lineTo(MARGIN.left + width, y + h)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.restore();
    let x = MARGIN.left;
    row.forEach((c, i) => {
      doc
        .font(fontOf(i))
        .fontSize(9.6)
        .fillColor(NAVY)
        .text(c, x + padX, y + padY, {
          width: (widths[i] ?? 0) - padX * 2,
          lineGap: 1.2,
        });
      x += widths[i] ?? 0;
    });
    doc.y = y + h;
  });
  doc.x = MARGIN.left;
  doc.y += 10;
}

function closing(doc: Doc, d: RegulationDocument): void {
  ensureSpace(doc, 60);
  doc.y += 14;
  divider(doc, PAGE.width / 2, doc.y, 110);
  doc.y += 14;
  doc.font('serif-bold').fontSize(11.5).fillColor(NAVY).text(d.closing, MARGIN.left, doc.y, {
    width: contentWidth(),
    align: 'center',
  });
}

// ---------- Колонтитулы и водяной знак ----------

function decorate(doc: Doc, d: RegulationDocument): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    // Колонтитулы рисуются за полями: без нижнего поля pdfkit не переносит текст на новую страницу.
    const saved = { ...doc.page.margins };
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    if (i > range.start) {
      pageHeader(doc, d);
      pageFooter(doc, d, i - range.start + 1, total);
    }
    if (d.draft) watermark(doc);
    doc.page.margins = saved;
  }
}

function pageHeader(doc: Doc, d: RegulationDocument): void {
  const knotH = 24;
  const knotW = knotH * (KNOT.width / KNOT.height);
  const y = 30;
  doc.image(KNOT.file, MARGIN.left, y - 2, { height: knotH });
  doc
    .font('sans')
    .fontSize(6.6)
    .fillColor(MUTED)
    .text('ЦИФРОВОЕ', MARGIN.left + knotW + 7, y + 1, {
      characterSpacing: 2.2,
      lineBreak: false,
    });
  doc
    .font('narrow')
    .fontSize(12.5)
    .fillColor(NAVY)
    .text('САМБО', MARGIN.left + knotW + 7, y + 8.5, {
      characterSpacing: 1,
      lineBreak: false,
    });
  const right = PAGE.width - MARGIN.right;
  const titleWidth = 300;
  doc
    .font('sans')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Положение · ${d.name}`, right - titleWidth, y + 10, {
      width: titleWidth,
      align: 'right',
      height: 9,
      ellipsis: true,
    });
  const ruleY = y + knotH + 6;
  const width = PAGE.width - MARGIN.left - MARGIN.right;
  doc.save();
  doc.rect(MARGIN.left, ruleY, width * 0.62, 1.4).fill(BLUE);
  doc.rect(MARGIN.left + width * 0.62, ruleY, width * 0.38, 1.4).fill(RED);
  doc.restore();
}

function pageFooter(doc: Doc, d: RegulationDocument, page: number, total: number): void {
  const y = PAGE.height - 40;
  const width = PAGE.width - MARGIN.left - MARGIN.right;
  doc.save();
  doc
    .moveTo(MARGIN.left, y - 8)
    .lineTo(MARGIN.left + width, y - 8)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke();
  doc.restore();
  doc
    .font('sans')
    .fontSize(7.4)
    .fillColor(MUTED)
    .text(d.generatedLine, MARGIN.left, y, {
      width: width - 90,
      lineBreak: false,
    });
  doc
    .font('sans-bold')
    .fontSize(8)
    .fillColor(NAVY)
    .text(`${page} / ${total}`, MARGIN.left + width - 90, y, {
      width: 90,
      align: 'right',
      lineBreak: false,
    });
}

function watermark(doc: Doc): void {
  doc.save();
  doc.rotate(-38, { origin: [PAGE.width / 2, PAGE.height / 2] });
  doc.font('narrow').fontSize(120).fillColor(RED).fillOpacity(0.07);
  doc.text('ПРОЕКТ', 0, PAGE.height / 2 - 70, { width: PAGE.width, align: 'center', lineBreak: false });
  doc.restore();
  doc.fillOpacity(1);
}
