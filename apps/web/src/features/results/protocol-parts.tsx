'use client';
// Печатные протоколы (план Phase 7b, §5; макеты согласованы заказчиком 2026-10-08): общее для листов A4 — стили
// по макету (книжная печать, чёрно-белая, цвет угла продублирован подписью), шапка, подписи, панель печати.
// Служебные документы: полные ФИО и год рождения; данные — с сервера (`export.create`, чтение — в журнал доступа).
import type { ProtocolHeader } from '@sde/contracts';
import { Button, EmptyState } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { formatDates } from '@/features/competitions/shared';
import { ApiError } from '@/lib/api';
import { pickName } from '@/lib/queries';

/**
 * Стили листа — по согласованному макету; на странице протокола @page переопределяет общую альбомную печать.
 * Номер листа — в поле страницы («Лист 1 из 2»), где браузер это умеет.
 */
const sheetCss = (sheetOf: string, of: string): string => `
@page { size: A4 portrait; margin: 12mm 12mm 14mm 16mm;
  @bottom-right { content: "${sheetOf} " counter(page) " ${of} " counter(pages); font: 7.5pt "PT Sans", Arial, sans-serif; color: #4a4a4a; } }
.proto { --ink:#111; --ink-soft:#4a4a4a; --rule:#222; --rule-soft:#b9b9b9; --fill:#f0f0f0;
  --red-side:#b3261e; --blue-side:#1f4e8c;
  --font-body:"PT Sans",Arial,"Helvetica Neue",sans-serif; --font-narrow:"PT Sans Narrow","Arial Narrow","PT Sans",sans-serif;
  --font-head:"PT Serif","Times New Roman",Georgia,serif; }
.proto .sheet { width:210mm; min-height:297mm; margin:0 auto; background:#fff; color:var(--ink);
  padding:14mm 14mm 16mm 18mm; box-shadow:0 1px 3px rgba(0,0,0,.18),0 8px 24px rgba(0,0,0,.12);
  display:flex; flex-direction:column; gap:4.2mm; font-family:var(--font-body); font-size:10pt; line-height:1.3;
  font-variant-numeric:tabular-nums; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.proto .doc-head { display:grid; gap:1mm; text-align:center; border-bottom:1.5pt solid var(--rule); padding-bottom:3mm; }
.proto .doc-org { font-size:9pt; color:var(--ink-soft); }
.proto .doc-title { font-family:var(--font-head); font-weight:700; font-size:15pt; letter-spacing:.02em; margin:1mm 0 0; }
.proto .doc-sub { font-size:10pt; }
.proto .meta { display:grid; grid-template-columns:2fr 1fr 1fr 1fr; border:.75pt solid var(--rule); }
.proto .meta div { padding:1.4mm 2mm; border-right:.5pt solid var(--rule-soft); display:grid; gap:.4mm; min-width:0; }
.proto .meta div:last-child { border-right:0; }
.proto .k { font-size:7.5pt; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-soft); }
.proto .meta .v { font-weight:700; }
.proto .sec { font-size:8.5pt; text-transform:uppercase; letter-spacing:.08em; font-weight:700; margin:1mm 0 -1.5mm; }
.proto .corners { display:grid; grid-template-columns:1fr 1fr; border:.75pt solid var(--rule); }
.proto .corner { padding:2mm 3mm; display:grid; gap:.6mm; min-width:0; align-content:start; }
.proto .corner + .corner { border-left:.75pt solid var(--rule); }
.proto .side { font-size:8pt; font-weight:700; text-transform:uppercase; letter-spacing:.08em; display:flex; align-items:center; gap:1.5mm; }
.proto .chip { width:3mm; height:3mm; border:.5pt solid var(--rule); display:inline-block; }
.proto .chip.red { background:var(--red-side); } .proto .chip.blue { background:var(--blue-side); }
.proto .corner .name { font-size:12pt; font-weight:700; }
.proto .corner .line { font-size:9pt; color:var(--ink-soft); }
.proto table { width:100%; border-collapse:collapse; }
.proto th, .proto td { border:.5pt solid var(--rule-soft); padding:1mm 1.6mm; text-align:left; vertical-align:top; }
.proto thead th { border-top:.75pt solid var(--rule); border-bottom:.75pt solid var(--rule); font-size:7.5pt; text-transform:uppercase; letter-spacing:.05em; font-weight:700; background:var(--fill); }
.proto .num { text-align:right; white-space:nowrap; } .proto .c { text-align:center; white-space:nowrap; }
.proto .log td { font-size:9pt; }
.proto .log .void td { color:var(--ink-soft); }
.proto .log .void .what { text-decoration:line-through; }
.proto .log .void .note { font-style:italic; }
.proto .log .mark td { background:var(--fill); font-weight:700; }
.proto .narrow { font-family:var(--font-narrow); }
.proto .result { display:grid; grid-template-columns:1.3fr 1fr 1fr; border:1.5pt solid var(--rule); }
.proto .result div { padding:2mm 3mm; display:grid; gap:.5mm; }
.proto .result div + div { border-left:.75pt solid var(--rule); }
.proto .result .v { font-size:12pt; font-weight:700; } .proto .result .score { font-size:16pt; }
.proto .facts { display:grid; gap:.8mm; font-size:9pt; } .proto .facts p { margin:0; }
.proto .signs { margin-top:auto; display:grid; grid-template-columns:1fr 1fr; gap:10mm; padding-top:4mm; break-inside:avoid; }
.proto .sign { display:grid; gap:1mm; font-size:9pt; }
.proto .sign .role { font-weight:700; }
.proto .sign .slot { display:grid; grid-template-columns:1fr auto; align-items:end; gap:3mm; }
.proto .sign .rule { border-bottom:.75pt solid var(--rule); height:8mm; }
.proto .sign .who { white-space:nowrap; }
.proto .sign .hint { font-size:7pt; color:var(--ink-soft); }
.proto .foot { display:flex; justify-content:space-between; gap:4mm; font-size:7.5pt; color:var(--ink-soft); border-top:.5pt solid var(--rule-soft); padding-top:1.5mm; }
.proto .places td { font-size:9pt; padding-block:.7mm; }
.proto .places td.place { font-weight:700; font-size:10pt; width:12mm; }
.proto .medal { display:inline-block; min-width:15mm; text-align:center; font-size:7pt; font-weight:700; letter-spacing:.04em; text-transform:uppercase; border:.75pt solid var(--rule); padding:.2mm 1mm; }
.proto .medal.GOLD { background:#e9d38a; } .proto .medal.SILVER { background:#d8d8d8; } .proto .medal.BRONZE { background:#ddb48c; }
.proto .bouts td { font-size:8.4pt; padding-block:.6mm; }
.proto .bouts .nob td { color:var(--ink-soft); font-style:italic; }
.proto .w { font-weight:700; }
.proto .legend { font-size:7.5pt; color:var(--ink-soft); margin:-2mm 0 0; }
.proto tr { break-inside:avoid; }
@media screen { .proto { padding:16px 0 48px; } .proto .scroll { overflow-x:auto; padding:0 16px; } }
@media print {
  html, body, #main { background:#fff !important; min-height:0 !important; }
  .proto .sheet { box-shadow:none; width:auto; min-height:0; padding:0; }
  .proto .scroll { overflow:visible; }
}
`;

export function Toolbar() {
  const t = useTranslations('protocols');
  return (
    <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2 px-4 print:hidden">
      <Button onClick={() => window.print()}>{t('print')}</Button>
      <p className="text-sm text-slate-600">{t('printHint')}</p>
    </div>
  );
}

export function useDateTime(timezone: string): (iso: string, withDate?: boolean) => string {
  const locale = useLocale();
  return (iso, withDate = true) =>
    new Intl.DateTimeFormat(locale, {
      ...(withDate ? { dateStyle: 'short' as const } : {}),
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(iso));
}

export function DocHead({ header, title }: { header: ProtocolHeader; title: string }) {
  const locale = useLocale();
  return (
    <header className="doc-head">
      <div className="doc-org">
        {[header.organizerName, header.disciplineName ? pickName(header.disciplineName, locale) : null]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <h1 className="doc-title">{title}</h1>
      <div className="doc-sub">
        {header.competitionName} · {formatDates(header.startDate, header.endDate, locale)}
      </div>
    </header>
  );
}

export function Signatures({ items }: { items: { role: string; name: string | null }[] }) {
  const t = useTranslations('protocols');
  return (
    <div className="signs">
      {items.map((s) => (
        <div key={s.role} className="sign">
          <span className="role">{s.role}</span>
          <div className="slot">
            <span className="rule" />
            <span className="who">/ {s.name ?? '________________'} /</span>
          </div>
          <span className="hint">{t('signHint')}</span>
        </div>
      ))}
    </div>
  );
}

export function ProtocolFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('protocols');
  return (
    <div className="proto">
      <style>{sheetCss(t('sheet'), t('of'))}</style>
      {children}
    </div>
  );
}

export function useNotFound(error: unknown): ReactNode {
  const t = useTranslations('protocols');
  if (error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
    return (
      <div className="p-4">
        <EmptyState title={error.code === 'FORBIDDEN' ? t('forbidden') : t('notFound')} />
      </div>
    );
  return null;
}
