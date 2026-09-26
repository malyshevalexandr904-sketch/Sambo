'use client';
// Импорт спортсменов из CSV/XLSX (API.md, 4.4; G-14): файл → разбор в фоне → предпросмотр с ошибками
// и дублями → выбор действия по каждой строке → фиксация → итог.
import {
  type DataEnvelope,
  type ImportAction,
  type ImportJobDto,
  type ImportRowReport,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, PageHeader, Select, Table, Td, Th } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FilePicker } from '@/components/file-picker';
import { Link } from '@/i18n/navigation';
import { api, uploadFile } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { DuplicateList } from './create';
import { useClubsWith, useRankName } from './shared';

const TEMPLATE_HEADER =
  'Фамилия;Имя;Отчество;Дата рождения;Пол;Разряд;Дата присвоения;Номер приказа;Email тренера';
const TEMPLATE_EXAMPLE = 'Иванов;Пётр;Сергеевич;17.05.2012;М;YOUTH_1;01.03.2024;№ 15-р от 01.03.2024;';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Выбор по строке: CREATE, SKIP или LINK:<athleteId>. */
type Choice = string;

/** Значения строки как в файле (строка с ошибкой не нормализована). */
const sourceText = (...parts: (string | undefined)[]): string =>
  parts.filter((p) => p && p.trim()).join(' ') || '—';

function defaultChoice(r: ImportRowReport): Choice {
  if (!r.data) return 'SKIP';
  return r.duplicates.length > 0 ? 'SKIP' : 'CREATE';
}

function downloadTemplate(): void {
  // BOM — чтобы Excel открыл UTF-8 с кириллицей.
  const blob = new Blob([`\uFEFF${TEMPLATE_HEADER}\r\n${TEMPLATE_EXAMPLE}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'athletes-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function AthletesImport() {
  const t = useTranslations();
  const clubs = useClubsWith('athlete.import');
  const [organizationId, setOrganizationId] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useAction();

  useEffect(() => {
    if (!organizationId && clubs.data[0]) setOrganizationId(clubs.data[0].id);
  }, [clubs.data, organizationId]);

  return (
    <>
      <PageHeader title={t('imports.title')} description={t('imports.hint')} />
      {!jobId ? (
        <Card className="max-w-3xl">
          <CardTitle>{t('imports.step1')}</CardTitle>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>{t('imports.rule1')}</li>
            <li>{t('imports.rule2')}</li>
            <li>{t('imports.rule3')}</li>
          </ol>
          <Button variant="ghost" className="mb-4" onClick={downloadTemplate}>
            {t('imports.template')}
          </Button>
          {clubs.data.length === 0 && !clubs.isPending ? (
            <Alert tone="warning">{t('athletes.noClubs')}</Alert>
          ) : null}
          <Field id="import-org" label={t('athletes.club')} className="mb-4">
            <Select
              id="import-org"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {clubs.data.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.shortName}
                </option>
              ))}
            </Select>
          </Field>
          {start.error ? (
            <Alert tone="danger" className="mb-4">
              {start.error}
            </Alert>
          ) : null}
          {organizationId ? (
            <FilePicker
              label={t('imports.chooseFile')}
              accept={`.csv,.xlsx,text/csv,${XLSX_MIME}`}
              busy={start.busy}
              onFile={(file) =>
                void start.run(async () => {
                  // Браузер может не знать MIME у CSV (Windows) — подставляем по расширению.
                  const typed =
                    file.type === 'text/csv' || file.type === XLSX_MIME
                      ? file
                      : new File([file], file.name, {
                          type: file.name.toLowerCase().endsWith('.xlsx') ? XLSX_MIME : 'text/csv',
                        });
                  const stored = await uploadFile('IMPORT', typed);
                  const res = await api<DataEnvelope<ImportJobDto>>('/athletes/imports', {
                    method: 'POST',
                    body: { organizationId, fileId: stored.id },
                    idempotencyKey: crypto.randomUUID(),
                  });
                  setJobId(res.data.id);
                })
              }
            />
          ) : null}
        </Card>
      ) : (
        <ImportJob id={jobId} onRestart={() => setJobId(null)} />
      )}
    </>
  );
}

function ImportJob({ id, onRestart }: { id: string; onRestart: () => void }) {
  const t = useTranslations();
  const job = useQuery({
    queryKey: qk.importJob(id),
    queryFn: async () => (await api<DataEnvelope<ImportJobDto>>(`/athletes/imports/${id}`)).data,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 1500 : false),
  });
  const data = job.data;
  if (!data || data.status === 'PENDING') {
    return (
      <Alert tone="info" title={t('imports.parsing')}>
        {t('imports.parsingHint')}
      </Alert>
    );
  }
  if (data.status === 'FAILED') {
    return (
      <Alert tone="danger" title={t('imports.failed')}>
        {t(`imports.fileErrors.${data.errorCode ?? 'FILE_UNREADABLE'}`)}
        <div className="mt-3">
          <Button variant="secondary" onClick={onRestart}>
            {t('imports.again')}
          </Button>
        </div>
      </Alert>
    );
  }
  return <ImportPreview job={data} onRestart={onRestart} />;
}

function ImportPreview({ job, onRestart }: { job: ImportJobDto; onRestart: () => void }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const locale = useLocale();
  const rankName = useRankName();
  const report = job.report;
  const [choices, setChoices] = useState<Record<number, Choice>>(() =>
    Object.fromEntries((report?.rows ?? []).map((r) => [r.row, defaultChoice(r)])),
  );
  const [result, setResult] = useState<ImportJobDto | null>(job.status === 'COMMITTED' ? job : null);
  const commit = useAction();
  if (!report) return null;
  const shown = result?.report ?? report;
  const committed = result !== null;
  const toCreate = Object.values(choices).filter((c) => c === 'CREATE').length;
  const toLink = Object.values(choices).filter((c) => c.startsWith('LINK:')).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{committed ? t('imports.resultTitle') : t('imports.previewTitle')}</CardTitle>
        <p className="text-sm text-slate-700">
          {t('imports.summary', {
            file: job.fileName,
            total: report.totalRows,
            valid: report.validRows,
            errors: report.errorRows,
            duplicates: report.duplicateRows,
          })}
        </p>
        {shown.results ? (
          <Alert tone="success" className="mt-3">
            {t('imports.results', shown.results)}
          </Alert>
        ) : null}
        {commit.error ? (
          <Alert tone="danger" className="mt-3">
            {commit.error}
          </Alert>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {!committed ? (
            <Button
              loading={commit.busy}
              disabled={toCreate + toLink === 0}
              onClick={() =>
                void commit.run(async () => {
                  const rows = report.rows.map((r) => {
                    const c = choices[r.row] ?? 'SKIP';
                    const action: ImportAction = c.startsWith('LINK:') ? 'LINK' : (c as ImportAction);
                    return action === 'LINK'
                      ? { row: r.row, action, athleteId: c.slice(5) }
                      : { row: r.row, action };
                  });
                  const res = await api<DataEnvelope<ImportJobDto>>(`/athletes/imports/${job.id}/commit`, {
                    method: 'POST',
                    body: { rows },
                  });
                  setResult(res.data);
                })
              }
            >
              {t('imports.commit', { create: toCreate, link: toLink })}
            </Button>
          ) : (
            <Link
              href="/athletes"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
            >
              {t('imports.toAthletes')}
            </Link>
          )}
          <Button variant="secondary" onClick={onRestart}>
            {t('imports.again')}
          </Button>
        </div>
      </Card>
      <Table>
        <thead>
          <tr>
            <Th>{t('imports.row')}</Th>
            <Th>{t('athletes.name')}</Th>
            <Th>{t('people.birthDate')}</Th>
            <Th>{t('athletes.rank')}</Th>
            <Th>{t('athletes.coach')}</Th>
            <Th>{t('imports.check')}</Th>
            <Th>{t('imports.action')}</Th>
          </tr>
        </thead>
        <tbody>
          {shown.rows.map((r) => (
            <tr
              key={r.row}
              className={
                r.errors.length > 0 ? 'bg-red-50' : r.duplicates.length > 0 ? 'bg-amber-50' : undefined
              }
            >
              <Td>{r.row}</Td>
              <Td>
                {r.data ? (
                  `${r.data.lastName} ${r.data.firstName} ${r.data.middleName ?? ''}`
                ) : (
                  <span className="text-slate-500">
                    {sourceText(r.source?.lastName, r.source?.firstName)}
                  </span>
                )}
              </Td>
              <Td>
                {r.data ? (
                  formatDate(r.data.birthDate, locale)
                ) : (
                  <span className="text-slate-500">{sourceText(r.source?.birthDate)}</span>
                )}
              </Td>
              <Td>{r.data?.sportRankCode ? rankName(r.data.sportRankCode) : '—'}</Td>
              <Td>{r.coach?.name ?? r.data?.coachEmail ?? '—'}</Td>
              <Td>
                {r.errors.length > 0 ? (
                  <ul className="text-red-800">
                    {r.errors.map((e) => (
                      <li key={`${e.path}-${e.code}`}>
                        {t.has(`imports.columns.${e.path}`) ? t(`imports.columns.${e.path}`) : e.path}:{' '}
                        {tf(e.code)}
                      </li>
                    ))}
                  </ul>
                ) : r.duplicates.length > 0 ? (
                  <>
                    <Badge tone="warning">{t('imports.possibleDuplicate')}</Badge>
                    <DuplicateList candidates={r.duplicates} />
                  </>
                ) : (
                  <Badge tone="success">{t('imports.ok')}</Badge>
                )}
              </Td>
              <Td>
                {r.result ? (
                  <span className={r.result.error ? 'text-red-800' : undefined}>
                    {t(`imports.actions.${r.result.action}`)}
                    {r.result.error
                      ? ` — ${t.has(`errors.${r.result.error}`) ? t(`errors.${r.result.error}`, { traceId: '—' }) : r.result.error}`
                      : ''}
                    {r.result.athleteId && !r.result.error ? (
                      <>
                        {' '}
                        <Link
                          href={`/athletes/${r.result.athleteId}`}
                          className="text-blue-700 hover:underline"
                        >
                          →
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <Select
                    className="min-w-40"
                    aria-label={t('imports.actionFor', { row: r.row })}
                    disabled={committed || !r.data}
                    value={choices[r.row] ?? 'SKIP'}
                    onChange={(e) => setChoices({ ...choices, [r.row]: e.target.value })}
                  >
                    <option value="CREATE">{t('imports.actions.CREATE')}</option>
                    <option value="SKIP">{t('imports.actions.SKIP')}</option>
                    {r.duplicates.map((d) => (
                      <option key={d.athleteId} value={`LINK:${d.athleteId}`}>
                        {t('imports.linkTo', { name: d.publicName, year: d.birthYear })}
                      </option>
                    ))}
                  </Select>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
