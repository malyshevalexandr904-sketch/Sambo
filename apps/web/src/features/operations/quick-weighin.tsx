'use client';
// Взвешивание у весов (правки 09.11.2026, п. 3): администратор открывает камеру, спортсмен показывает QR из личного
// кабинета — открывается его анкета (ФИО, дата рождения, документы, заявленная категория). Спортсмен встаёт на весы,
// у администратора три кнопки: «Норма», «Недовес», «Перевес». При недовесе и перевесе он сам выбирает: спортсмен
// не участвует или выступает в категории ниже (недовес) / выше (перевес). Вес вводить не обязательно.
import {
  type Competition,
  type DataEnvelope,
  kgToGrams,
  type WeighInCardDto,
  type WeighInVerdict,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, cn, Field, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useWeightLabel } from '@/features/competitions/shared';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { QrScanner } from './qr-scanner';

export function QuickWeighInCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('quickWeigh');
  const errorMessage = useErrorMessage();
  const [cards, setCards] = useState<WeighInCardDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRecord = c.allowedActions.includes('weighin.record');
  const scan = async (qrToken: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DataEnvelope<WeighInCardDto[]>>(`/competitions/${c.id}/weigh-in/cards`, {
        query: { qrToken },
      });
      setCards(res.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="-mt-2 mb-3 text-sm text-slate-600">{t('hint')}</p>
      {c.status !== 'CHECK_IN' ? (
        <Alert tone="info" className="mb-3">
          {t('notStage')}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {cards ? (
        <div className="space-y-3">
          {cards.length === 0 ? <Alert tone="warning">{t('noEntries')}</Alert> : null}
          {cards.map((card) => (
            <AthleteCard
              key={card.entryId}
              card={card}
              canRecord={canRecord && c.status === 'CHECK_IN'}
              onChanged={(next) =>
                setCards((list) => (list ?? []).map((x) => (x.entryId === next.entryId ? next : x)))
              }
            />
          ))}
          <Button size="lg" variant="secondary" onClick={() => setCards(null)}>
            {t('next')}
          </Button>
        </div>
      ) : (
        <QrScanner onToken={(token) => void scan(token)} busy={busy} />
      )}
    </Card>
  );
}

function AthleteCard({
  card,
  canRecord,
  onChanged,
}: {
  card: WeighInCardDto;
  canRecord: boolean;
  onChanged: (card: WeighInCardDto) => void;
}) {
  const t = useTranslations('quickWeigh');
  const locale = useLocale();
  const weightLabel = useWeightLabel();
  const queryClient = useQueryClient();
  const action = useAction();
  const [weight, setWeight] = useState('');
  const [problem, setProblem] = useState<Exclude<WeighInVerdict, 'NORMAL'> | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const grams = kgToGrams(weight);
  const send = (verdict: WeighInVerdict, extra: { action?: 'WITHDRAW' | 'TRANSFER' } = {}): void => {
    void action.run(async () => {
      const res = await api<DataEnvelope<WeighInCardDto>>(`/entries/${card.entryId}/weigh-in/decision`, {
        method: 'POST',
        body: {
          verdict,
          ...extra,
          ...(grams !== null && grams >= 10_000 && grams <= 250_000 ? { weightGrams: grams } : {}),
        },
      });
      onChanged(res.data);
      setProblem(null);
      setDone(
        verdict === 'NORMAL'
          ? t('doneNormal')
          : extra.action === 'WITHDRAW'
            ? t('doneWithdrawn')
            : t('doneTransferred', { category: pickName(res.data.category.name, locale) }),
      );
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes('weigh-in') });
    });
  };
  const neighbour = problem === 'UNDER' ? card.lighter : problem === 'OVER' ? card.heavier : null;
  return (
    <div className="rounded-xl border-2 border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold">
            {[card.lastName, card.firstName, card.middleName].filter(Boolean).join(' ')}
          </p>
          <p className="text-sm text-slate-600">
            {formatDate(card.birthDate, locale)} · {card.organization.shortName || card.organization.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={card.documentsOk ? 'success' : 'danger'}>
            {card.documentsOk ? t('docsOk') : t('docsProblem')}
          </Badge>
          <Badge
            tone={card.weighIn === 'PASSED' ? 'success' : card.weighIn === 'EXPECTED' ? 'neutral' : 'warning'}
          >
            {t(`status.${card.weighIn}`)}
          </Badge>
        </div>
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-lg">
        {t('declared')}: <span className="font-semibold">{pickName(card.category.name, locale)}</span>{' '}
        <span className="text-slate-600">({weightLabel(card.category.weight)})</span>
      </p>
      {done ? (
        <Alert tone="success" className="mt-3">
          {done}
        </Alert>
      ) : null}
      {action.error ? (
        <Alert tone="danger" className="mt-3">
          {action.error}
        </Alert>
      ) : null}
      {canRecord ? (
        <>
          <Field
            id={`qw-${card.entryId}`}
            label={t('weight')}
            hint={t('weightHint')}
            className="mt-3 max-w-48"
          >
            <Input
              id={`qw-${card.entryId}`}
              inputMode="decimal"
              autoComplete="off"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              disabled={action.busy}
              onClick={() => send('NORMAL')}
              className="min-h-14 rounded-lg bg-green-600 px-4 text-lg font-bold text-white hover:bg-green-700 disabled:opacity-60"
            >
              {t('normal')}
            </button>
            {(['UNDER', 'OVER'] as const).map((v) => (
              <button
                key={v}
                type="button"
                disabled={action.busy}
                aria-pressed={problem === v}
                onClick={() => setProblem(problem === v ? null : v)}
                className={cn(
                  'min-h-14 rounded-lg px-4 text-lg font-bold text-white disabled:opacity-60',
                  v === 'UNDER' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-700',
                  problem === v && 'ring-4 ring-offset-2 ring-slate-400',
                )}
              >
                {t(v === 'UNDER' ? 'under' : 'over')}
              </button>
            ))}
          </div>
          {problem ? (
            <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
              <p className="mb-2 font-medium">{t(problem === 'UNDER' ? 'underWhat' : 'overWhat')}</p>
              <div className="flex flex-wrap gap-2">
                {neighbour ? (
                  <Button loading={action.busy} onClick={() => send(problem, { action: 'TRANSFER' })}>
                    {t(problem === 'UNDER' ? 'toLighter' : 'toHeavier', {
                      category: `${pickName(neighbour.name, locale)} (${weightLabel(neighbour.weight)})`,
                    })}
                  </Button>
                ) : (
                  <span className="text-sm text-slate-600">{t('noNeighbour')}</span>
                )}
                <Button
                  variant="danger"
                  loading={action.busy}
                  onClick={() => send(problem, { action: 'WITHDRAW' })}
                >
                  {t('withdraw')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
