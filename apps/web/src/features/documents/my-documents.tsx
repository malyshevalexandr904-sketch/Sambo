'use client';
// «Мои документы» спортсмена (правки 05.11.2026): по карточке на каждый документ, нужный для соревнований. Цвет
// карточки — состояние: охра — ещё не загружен, зелёный — загружен и действует, красный — срок истёк (или документ
// отклонён при проверке). При загрузке указывается срок действия: платформа заранее предупредит об окончании
// (уведомления за 30, 7 и 1 день — worker). Заменить документ можно в любой момент без объяснения причин.
import {
  ADMISSION_PASSPORT_AGE,
  type Athlete,
  type DataEnvelope,
  type DocumentDto,
  type DocumentTypeDto,
  type DownloadUrl,
  fullYearsOn,
  type Page,
} from '@sde/contracts';
import { Alert, Button, cn, EmptyState, Input, PageHeader, Spinner } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { FilePicker } from '@/components/file-picker';
import { fieldErrors } from '@/components/person-fields';
import { Link } from '@/i18n/navigation';
import { api, uploadFile } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useFieldMessage } from '@/lib/errors';
import { qk, useDocumentTypes, useMyAthletes } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { DocumentStatusBadge } from './shared';

/** С 14 лет личность удостоверяет паспорт; младше — свидетельство о рождении вместе со справкой из школы. */
const PASSPORT_AGE = ADMISSION_PASSPORT_AGE;
/** «Скоро истекает» — за столько дней карточка показывает предупреждение (уведомления — те же 30 дней). */
const SOON_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type SlotKey = 'identity' | 'insurance' | 'oms' | 'rank' | 'medical';
type State = 'missing' | 'ok' | 'expired';

interface Slot {
  key: SlotKey;
  icon: ReactNode;
  /** Виды документов карточки; у документа личности младше 14 лет — два файла. */
  types: string[];
}

/** Бессрочные документы: срок действия не спрашиваем. */
const NO_EXPIRY = new Set(['BIRTH_CERTIFICATE']);

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const daysLeft = (date: string, today: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

/** Состояние документа одного вида: последний загруженный (замена — новая загрузка). */
function stateOf(doc: DocumentDto | undefined, today: string): State {
  if (!doc) return 'missing';
  if (doc.status === 'REJECTED' || doc.status === 'EXPIRED') return 'expired';
  if (doc.expirationDate && doc.expirationDate < today) return 'expired';
  return 'ok';
}

const worst = (states: State[]): State =>
  states.includes('expired') ? 'expired' : states.includes('missing') ? 'missing' : 'ok';

const TONE: Record<State, { card: string; icon: string; text: string; dot: string }> = {
  missing: {
    card: 'border-orange-300 bg-orange-50',
    icon: 'bg-orange-100 text-orange-700',
    text: 'text-orange-900',
    dot: 'bg-orange-500',
  },
  ok: {
    card: 'border-green-300 bg-green-50',
    icon: 'bg-green-100 text-green-700',
    text: 'text-green-800',
    dot: 'bg-green-600',
  },
  expired: {
    card: 'border-red-300 bg-red-50',
    icon: 'bg-red-100 text-red-700',
    text: 'text-red-800',
    dot: 'bg-red-600',
  },
};

const svg = (children: ReactNode): ReactNode => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-7 w-7"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS: Record<SlotKey, ReactNode> = {
  // Удостоверение личности: карточка с портретом.
  identity: svg(
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8.5" cy="11" r="2.2" />
      <path d="M5.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14 10h4.5M14 13.5h3" />
    </>,
  ),
  // Спортивная страховка: щит с галочкой.
  insurance: svg(
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </>,
  ),
  // Полис ОМС: карточка с медицинским крестом.
  oms: svg(
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M8 9.5v5M5.5 12h5M14 10h4.5M14 13.5h3" />
    </>,
  ),
  // Разряд или звание: медаль на ленте.
  rank: svg(
    <>
      <path d="M8 3h8l-2.5 6h-3L8 3Z" />
      <circle cx="12" cy="15" r="5" />
      <path d="m12 12.6.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2.8-1.6Z" />
    </>,
  ),
  // Медицинский допуск: сердце с кардиограммой.
  medical: svg(
    <>
      <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" />
      <path d="M6 12.5h3l1.4-2.3 2.2 4.3 1.4-2h4" />
    </>,
  ),
};

function openDocument(id: string, onError: () => void): void {
  // Окно открывается сразу (иначе браузер заблокирует всплывающее окно), адрес подставляется после ответа.
  const win = window.open('about:blank', '_blank');
  if (win) win.opener = null;
  api<DataEnvelope<DownloadUrl>>(`/documents/${id}/download-url`)
    .then((res) => {
      if (win) win.location.href = res.data.url;
      else window.location.href = res.data.url;
    })
    .catch(() => {
      win?.close();
      onError();
    });
}

export function MyDocuments() {
  const t = useTranslations('myDocuments');
  const mine = useMyAthletes();
  const self = (mine.data ?? []).find((a) => a.relation === 'SELF');

  if (mine.isPending) return <Spinner />;
  return (
    <>
      <PageHeader title={t('title')} description={t('lead')} />
      {self ? (
        <AthleteDocumentCards athleteId={self.athleteId} />
      ) : (
        <EmptyState title={t('noProfile')}>
          <Link href="/onboarding" className="text-blue-700 underline">
            {t('noProfileLink')}
          </Link>
        </EmptyState>
      )}
    </>
  );
}

/** Карточки документов спортсмена — на странице «Мои документы»; можно встроить и в другие разделы. */
export function AthleteDocumentCards({ athleteId }: { athleteId: string }) {
  const t = useTranslations('myDocuments');
  const athlete = useQuery({
    queryKey: qk.athlete(athleteId),
    queryFn: async () => (await api<DataEnvelope<Athlete>>(`/athletes/${athleteId}`)).data,
  });
  const docs = useQuery({
    queryKey: qk.documents({ athleteId }),
    queryFn: () => api<Page<DocumentDto>>('/documents', { query: { athleteId, limit: 100 } }),
  });
  const types = useDocumentTypes();

  if (athlete.isPending || docs.isPending || types.isPending) return <Spinner />;
  if (athlete.error || docs.error || !athlete.data) return <Alert tone="danger">{t('loadFailed')}</Alert>;

  const today = todayIso();
  const age = fullYearsOn(athlete.data.person.birthDate, today);
  const adult = age >= PASSPORT_AGE;
  const slots: Slot[] = [
    {
      key: 'identity',
      icon: ICONS.identity,
      types: adult ? ['PASSPORT'] : ['BIRTH_CERTIFICATE', 'SCHOOL_CERTIFICATE'],
    },
    { key: 'insurance', icon: ICONS.insurance, types: ['INSURANCE_POLICY'] },
    { key: 'oms', icon: ICONS.oms, types: ['OMS_POLICY'] },
    { key: 'rank', icon: ICONS.rank, types: ['SPORT_RANK_ORDER'] },
    { key: 'medical', icon: ICONS.medical, types: ['MEDICAL_CERTIFICATE'] },
  ];
  // Документы приходят от новых к старым: первый документ вида — действующий.
  const latest = new Map<string, DocumentDto>();
  for (const d of docs.data?.data ?? []) if (!latest.has(d.typeCode)) latest.set(d.typeCode, d);
  const states = slots.map((s) => worst(s.types.map((c) => stateOf(latest.get(c), today))));
  const done = states.filter((s) => s === 'ok').length;

  return (
    <div className="animate-fade-up">
      <Summary done={done} total={slots.length} />
      <div className="grid gap-4 lg:grid-cols-2">
        {slots.map((slot, i) => (
          <DocumentCard
            key={slot.key}
            slot={slot}
            state={states[i]!}
            adult={adult}
            athleteId={athleteId}
            latest={latest}
            types={types.data ?? []}
            today={today}
          />
        ))}
      </div>
    </div>
  );
}

function Summary({ done, total }: { done: number; total: number }) {
  const t = useTranslations('myDocuments');
  const pct = Math.round((done / total) * 100);
  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-slate-900">{t('progress', { done, total })}</p>
        <p className="text-sm text-slate-600">{done === total ? t('allDone') : t('notAllDone')}</p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700',
            done === total ? 'bg-green-600' : 'bg-blue-600',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {(['missing', 'ok', 'expired'] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-full', TONE[s].dot)} aria-hidden="true" />
            {t(`legend.${s}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocumentCard({
  slot,
  state,
  adult,
  athleteId,
  latest,
  types,
  today,
}: {
  slot: Slot;
  state: State;
  adult: boolean;
  athleteId: string;
  latest: Map<string, DocumentDto>;
  types: DocumentTypeDto[];
  today: string;
}) {
  const t = useTranslations('myDocuments');
  const tone = TONE[state];
  const hint =
    slot.key === 'identity'
      ? t(adult ? 'slots.identity.hintAdult' : 'slots.identity.hintChild')
      : t(`slots.${slot.key}.hint`);
  return (
    <section
      aria-labelledby={`doc-${slot.key}`}
      className={cn('flex flex-col rounded-xl border-2 p-4 transition-colors duration-300 sm:p-5', tone.card)}
    >
      <div className="flex items-start gap-3">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', tone.icon)}>
          {slot.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`doc-${slot.key}`} className="text-base font-semibold text-slate-900">
            {t(`slots.${slot.key}.title`)}
          </h2>
          <p className="mt-0.5 text-sm text-slate-700">{hint}</p>
        </div>
      </div>
      <p className={cn('mt-3 flex items-center gap-2 text-sm font-medium', tone.text)} role="status">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
        {t(`state.${state}`)}
      </p>
      <div className="mt-3 space-y-3">
        {slot.types.map((code) => (
          <DocumentPart
            key={code}
            code={code}
            showName={slot.types.length > 1}
            athleteId={athleteId}
            doc={latest.get(code)}
            type={types.find((x) => x.code === code)}
            today={today}
          />
        ))}
      </div>
    </section>
  );
}

/** Один файл карточки: что загружено, срок, «Открыть», загрузка или замена. */
function DocumentPart({
  code,
  showName,
  athleteId,
  doc,
  type,
  today,
}: {
  code: string;
  showName: boolean;
  athleteId: string;
  doc: DocumentDto | undefined;
  type: DocumentTypeDto | undefined;
  today: string;
}) {
  const t = useTranslations('myDocuments');
  const locale = useLocale();
  const state = stateOf(doc, today);
  const [open, setOpen] = useState(false);
  const [openError, setOpenError] = useState(false);
  const left = doc?.expirationDate ? daysLeft(doc.expirationDate, today) : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {showName ? <p className="mb-1 text-sm font-semibold text-slate-900">{t(`parts.${code}`)}</p> : null}
      {doc ? (
        <div className="text-sm text-slate-700">
          <p className="flex flex-wrap items-center gap-2">
            <span className="break-all">{doc.file.originalName}</span>
            <DocumentStatusBadge status={doc.status} />
          </p>
          <p className="mt-1 text-slate-600">
            {t('uploadedOn', { date: formatDate(doc.uploadedAt, locale) })}
            {' · '}
            {doc.expirationDate
              ? t(state === 'expired' && doc.status !== 'REJECTED' ? 'expiredOn' : 'validUntil', {
                  date: formatDate(doc.expirationDate, locale),
                })
              : t('noExpiry')}
          </p>
          {doc.status === 'REJECTED' ? (
            <p className="mt-1 font-medium text-red-800">
              {t('rejected', { reason: doc.rejectReason ?? '—' })}
            </p>
          ) : null}
          {state === 'ok' && left !== null && left <= SOON_DAYS ? (
            <p className="mt-1 font-medium text-amber-800">{t('expiresSoon', { days: left })}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpenError(false);
                openDocument(doc.id, () => setOpenError(true));
              }}
            >
              {t('open')}
            </Button>
            {!open ? (
              <Button
                size="sm"
                variant={state === 'expired' ? 'primary' : 'secondary'}
                onClick={() => setOpen(true)}
              >
                {t('replace')}
              </Button>
            ) : null}
          </div>
          {openError ? <p className="mt-1 text-sm text-red-700">{t('openFailed')}</p> : null}
        </div>
      ) : !open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">{t('notUploaded')}</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('upload')}
          </Button>
        </div>
      ) : null}
      {open ? (
        <UploadForm
          code={code}
          athleteId={athleteId}
          type={type}
          replacing={doc}
          onDone={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function UploadForm({
  code,
  athleteId,
  type,
  replacing,
  onDone,
}: {
  code: string;
  athleteId: string;
  type: DocumentTypeDto | undefined;
  replacing: DocumentDto | undefined;
  onDone: () => void;
}) {
  const t = useTranslations('myDocuments');
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const upload = useAction();
  const id = useId();
  const needsDate = !NO_EXPIRY.has(code);
  const [expirationDate, setExpirationDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dateMissing = needsDate && !expirationDate;

  if (!type) return <p className="mt-2 text-sm text-red-700">{t('typeMissing')}</p>;
  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
      {needsDate ? (
        <div>
          <label htmlFor={`${id}-exp`} className="block text-sm font-medium text-slate-900">
            {t('expirationLabel')}
          </label>
          <p className="text-xs text-slate-600">{t('expirationHint')}</p>
          <Input
            id={`${id}-exp`}
            type="date"
            min={todayIso()}
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            className="mt-1 max-w-56"
            aria-invalid={errors.expirationDate ? true : undefined}
          />
          {errors.expirationDate ? (
            <p className="mt-1 text-sm text-red-700">{tf(errors.expirationDate)}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-600">{t('noExpiryHint')}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {dateMissing ? (
          <p className="text-sm text-slate-600">{t('dateFirst')}</p>
        ) : (
          <FilePicker
            label={replacing ? t('chooseReplacement') : t('chooseFile')}
            accept={type.allowedMime.join(',')}
            busy={upload.busy}
            onFile={(file) => {
              setErrors({});
              void upload.run(async () => {
                try {
                  const stored = await uploadFile('DOCUMENT', file);
                  await api('/documents', {
                    method: 'POST',
                    body: {
                      typeCode: code,
                      fileId: stored.id,
                      owner: { athleteId },
                      ...(needsDate ? { expirationDate } : {}),
                    },
                  });
                  // Прежний документ ещё не взят на проверку — убираем, чтобы не копился; проверенный остаётся в
                  // истории (его видел проверяющий), действующим считается новый.
                  if (replacing?.allowedActions.includes('document.delete'))
                    await api(`/documents/${replacing.id}`, { method: 'DELETE' }).catch(() => undefined);
                  await queryClient.invalidateQueries({ queryKey: ['documents'] });
                  onDone();
                } catch (err) {
                  setErrors(fieldErrors(err));
                  throw err;
                }
              });
            }}
          />
        )}
        <Button size="sm" variant="ghost" onClick={onDone} disabled={upload.busy}>
          {t('cancel')}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {t('limits', {
          types: type.allowedMime.map((m) => m.split('/')[1]?.toUpperCase()).join(', '),
          size: Math.round(type.maxSizeBytes / 1024 / 1024),
        })}
      </p>
      {upload.error ? <Alert tone="danger">{upload.error}</Alert> : null}
    </div>
  );
}
