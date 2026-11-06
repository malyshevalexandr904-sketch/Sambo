'use client';
// Управление турниром по стадиям (правки 05.11.2026): шкала стадий и подсказка «что происходит, что сделать, что
// дальше» для организатора и администратора; оформление публичной страницы (шаблон афиши, трансляция) и медиа
// завершённого турнира. Права и условия проверяет сервер, здесь — только понятный порядок действий.
import {
  type Competition,
  type CompetitionMediaDto,
  type DataEnvelope,
  POSTER_TEMPLATES,
  stageOfCompetition,
  type TournamentStage,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, cn, Field, Input } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { api, uploadFile } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { Poster, type PosterData } from '@/features/tournament/poster';
import { StageStepper } from '@/features/tournament/stage-stepper';
import { formatInZone } from './shared';

/** Вкладки, с которыми работают на стадии: в шапке турнира они идут первыми и отмечены точкой. */
export const STAGE_TABS: Record<TournamentStage, readonly string[]> = {
  DRAFT: ['overview', 'regulation', 'categories'],
  REVIEW: ['overview', 'regulation', 'categories', 'staff'],
  PUBLISHED: ['overview', 'regulation', 'categories', 'recruitment'],
  REGISTRATION: ['overview', 'applications', 'entries'],
  MANDATE: ['overview', 'applications', 'entries', 'admission'],
  WEIGH_IN: ['overview', 'weighin', 'checkin', 'admission', 'medical'],
  DRAW: ['overview', 'draws', 'schedule', 'crews'],
  LIVE: ['overview', 'schedule', 'results'],
  FINISHED: ['overview', 'results'],
};

/** Что сделать на стадии: текст и вкладка, куда ведёт ссылка. */
const TODO: Record<TournamentStage, { key: string; tab: string | null }[]> = {
  DRAFT: [],
  REVIEW: [
    { key: 'categories', tab: 'categories' },
    { key: 'regulation', tab: 'regulation' },
    { key: 'dates', tab: null },
    { key: 'poster', tab: null },
  ],
  PUBLISHED: [
    { key: 'checkPublic', tab: null },
    { key: 'judges', tab: 'recruitment' },
    { key: 'autoOpen', tab: null },
  ],
  REGISTRATION: [
    { key: 'review', tab: 'applications' },
    { key: 'entries', tab: 'entries' },
    { key: 'autoClose', tab: null },
  ],
  MANDATE: [
    { key: 'mandate', tab: 'applications' },
    { key: 'fixOnly', tab: null },
    { key: 'autoReject', tab: null },
  ],
  WEIGH_IN: [
    { key: 'qr', tab: 'weighin' },
    { key: 'arrival', tab: 'checkin' },
    { key: 'admission', tab: 'admission' },
  ],
  DRAW: [
    { key: 'autoDraw', tab: 'draws' },
    { key: 'schedule', tab: 'schedule' },
    { key: 'crews', tab: 'crews' },
  ],
  LIVE: [
    { key: 'stream', tab: null },
    { key: 'mats', tab: 'schedule' },
    { key: 'results', tab: 'results' },
  ],
  FINISHED: [
    { key: 'publishResults', tab: 'results' },
    { key: 'media', tab: null },
  ],
};

/** Шкала стадий и подсказка: что происходит, зачем, что сделать сейчас и что будет дальше. */
export function StageGuideCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('stages');
  const locale = useLocale();
  const pathname = usePathname();
  const stage = stageOfCompetition(c.status);
  if (!stage) return null;
  const values = {
    opens: formatInZone(c.registrationStartsAt, c.timezone, locale),
    closes: formatInZone(c.registrationEndsAt, c.timezone, locale),
  };
  const todo = TODO[stage];
  return (
    <Card className="xl:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{t('manage.title', { stage: t(`names.${stage}`) })}</CardTitle>
        {c.status !== 'DRAFT' ? (
          <Link href={`/tournaments/${c.slug}`} className="text-sm font-medium text-blue-700 hover:underline">
            {t('manage.publicPage')} ↗
          </Link>
        ) : null}
      </div>
      <StageStepper stage={stage} variant="manage" className="mt-2" />
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <section className="rounded-lg bg-slate-50 p-3">
          <h3 className="text-sm font-semibold">{t('manage.whatTitle')}</h3>
          <p className="mt-1 text-sm text-slate-700">{t(`manage.what.${stage}`, values)}</p>
          <p className="mt-2 text-xs text-slate-600">{t(`manage.why.${stage}`)}</p>
        </section>
        <section className="rounded-lg bg-blue-50 p-3">
          <h3 className="text-sm font-semibold text-blue-900">{t('manage.todoTitle')}</h3>
          <ol className="mt-1 space-y-1.5 text-sm">
            {todo.map((x, i) => (
              <li key={x.key} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-700 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span>
                  {t(`manage.todo.${x.key}`, values)}
                  {x.tab ? (
                    <>
                      {' '}
                      <Link
                        href={{ pathname, query: { tab: x.tab } }}
                        className="whitespace-nowrap font-medium text-blue-700 hover:underline"
                      >
                        {t('manage.open')} →
                      </Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-lg bg-green-50 p-3">
          <h3 className="text-sm font-semibold text-green-900">{t('manage.nextTitle')}</h3>
          <p className="mt-1 text-sm text-slate-700">{t(`manage.next.${stage}`, values)}</p>
        </section>
      </div>
    </Card>
  );
}

// ---------- Оформление публичной страницы ----------

function posterOf(c: Competition): PosterData {
  return {
    name: c.name,
    startDate: c.startDate,
    endDate: c.endDate,
    city: c.venue?.city ?? null,
    venueName: c.venue?.name ?? null,
    organizerName: c.organizer.name,
    logoUrl: c.logoUrl,
    rated: c.competitionType === 'RATED',
    groups: [],
  };
}

export function PresentationCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('stages.presentation');
  const queryClient = useQueryClient();
  const action = useAction();
  const [template, setTemplate] = useState(c.posterTemplate);
  const [stream, setStream] = useState(c.liveStreamUrl ?? '');
  const [saved, setSaved] = useState(false);
  const dirty = template !== c.posterTemplate || stream.trim() !== (c.liveStreamUrl ?? '');
  const save = (): void => {
    setSaved(false);
    void action.run(async () => {
      await api(`/competitions/${c.id}/presentation`, {
        method: 'PUT',
        body: { posterTemplate: template, liveStreamUrl: stream.trim() || null },
      });
      await queryClient.invalidateQueries({ queryKey: qk.competition(c.id) });
      setSaved(true);
    });
  };
  const data = posterOf(c);
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('title')}</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-slate-600">{t('hint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('template')}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {POSTER_TEMPLATES.map((x) => (
            <label
              key={x}
              className={cn(
                'cursor-pointer rounded-xl border-2 p-1.5 transition',
                template === x
                  ? 'border-blue-700 ring-2 ring-blue-200'
                  : 'border-transparent hover:border-slate-300',
              )}
            >
              <input
                type="radio"
                name="poster-template"
                value={x}
                checked={template === x}
                onChange={() => setTemplate(x)}
                className="sr-only"
              />
              <div className="pointer-events-none text-[8px] sm:text-[9px]" aria-hidden="true">
                <Poster data={data} template={x} />
              </div>
              <span className="mt-1.5 block text-center text-sm font-medium">{t(`templates.${x}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field id="live-stream" label={t('stream')} hint={t('streamHint')} className="mt-4">
        <Input
          id="live-stream"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={stream}
          onChange={(e) => {
            setStream(e.target.value);
            setSaved(false);
          }}
          maxLength={500}
        />
      </Field>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button loading={action.busy} disabled={!dirty} onClick={save}>
          {t('save')}
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-green-800">
            {t('saved')}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

// ---------- Медиа завершённого турнира ----------

export function MediaCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('stages.media');
  const errorMessage = useErrorMessage();
  const inputId = useId();
  const queryClient = useQueryClient();
  const key = ['competitions', c.id, 'media'];
  const media = useQuery({
    queryKey: key,
    queryFn: async () => (await api<DataEnvelope<CompetitionMediaDto[]>>(`/competitions/${c.id}/media`)).data,
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [caption, setCaption] = useState('');
  const action = useAction();
  const set = (list: CompetitionMediaDto[]) => queryClient.setQueryData(key, list);

  const uploadPhotos = async (files: File[]): Promise<void> => {
    setError(null);
    setProgress({ done: 0, total: files.length });
    let failed = 0;
    for (const [i, file] of files.entries()) {
      try {
        const stored = await uploadFile('COMPETITION_MEDIA', file);
        const res = await api<DataEnvelope<CompetitionMediaDto[]>>(`/competitions/${c.id}/media`, {
          method: 'POST',
          body: { kind: 'PHOTO', fileId: stored.id },
        });
        set(res.data);
      } catch (e) {
        failed += 1;
        setError(`${file.name}: ${errorMessage(e)}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    if (failed === 0) setError(null);
  };

  const addVideo = (): void => {
    void action.run(async () => {
      const res = await api<DataEnvelope<CompetitionMediaDto[]>>(`/competitions/${c.id}/media`, {
        method: 'POST',
        body: { kind: 'VIDEO', url: videoUrl.trim(), ...(caption.trim() ? { caption: caption.trim() } : {}) },
      });
      set(res.data);
      setVideoUrl('');
      setCaption('');
    });
  };

  const remove = (id: string): void => {
    void action.run(async () => {
      const res = await api<DataEnvelope<CompetitionMediaDto[]>>(`/competitions/${c.id}/media/${id}`, {
        method: 'DELETE',
      });
      set(res.data);
    });
  };

  const list = media.data ?? [];
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('title')}</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-slate-600">{t('hint')}</p>
      {error || action.error ? (
        <Alert tone="danger" className="mb-3">
          {error ?? action.error}
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-dashed border-slate-300 p-4">
          <p className="text-sm font-medium">{t('photos')}</p>
          <p className="mt-1 text-xs text-slate-600">{t('photosHint')}</p>
          <label
            htmlFor={inputId}
            className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
          >
            {progress ? t('uploading', progress) : t('choosePhotos')}
          </label>
          <input
            id={inputId}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={!!progress}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length > 0) void uploadPhotos(files);
            }}
          />
        </div>
        <form
          className="rounded-lg border border-dashed border-slate-300 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            addVideo();
          }}
        >
          <p className="text-sm font-medium">{t('video')}</p>
          <Field id="media-video" label={t('videoUrl')} hint={t('videoHint')} className="mt-2">
            <Input
              id="media-video"
              type="url"
              placeholder="https://"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              maxLength={500}
            />
          </Field>
          <Field id="media-caption" label={t('caption')} className="mt-2">
            <Input
              id="media-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            className="mt-3"
            loading={action.busy}
            disabled={!videoUrl.trim()}
          >
            {t('addVideo')}
          </Button>
        </form>
      </div>
      {list.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {list.map((m) => (
            <li key={m.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
              {m.kind === 'PHOTO' ? (
                <img src={m.url} alt={m.caption ?? ''} className="aspect-square w-full object-cover" />
              ) : (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-slate-100 p-2 text-center text-xs"
                >
                  <span aria-hidden="true" className="text-2xl">
                    ▶
                  </span>
                  <span className="line-clamp-2">{m.caption ?? t('video')}</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('removeConfirm'))) remove(m.id);
                }}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={t('remove')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : media.isPending ? null : (
        <p className="mt-4 text-sm text-slate-600">{t('empty')}</p>
      )}
    </Card>
  );
}
