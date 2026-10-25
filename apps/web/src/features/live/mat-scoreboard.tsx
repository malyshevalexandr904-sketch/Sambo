'use client';
// Табло ковра для зала (Phase 8a, план §3): во весь экран, видно с трибуны — красный слева, синий справа,
// «Фамилия И.» и клуб (без согласия на распространение ПДн — только угол и клуб), баллы, наказания, удержание,
// время схватки; между схватками — вызов и следующая пара, после — результат. Данные — публичный снимок ковра и
// живой канал `public:mat`; без живого соединения — опрос снимка. Время досчитывается здесь по часам сервера.
import {
  type DataEnvelope,
  liveClockMs,
  liveHoldMs,
  type LiveMatchDto,
  type LiveSideDto,
  type PublicMatStateDto,
  type Side,
} from '@sde/contracts';
import { cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock, useRefereeLabels } from '@/features/refereeing/labels';
import { useRoundLabel } from '@/features/scheduling/shared';
import { liveClient, useChannelHealth, useLiveChannel, useLiveStatus } from '@/lib/live';
import { pickName } from '@/lib/queries';
import { mergeMatState, type ScoreboardView, scoreboardView, upNext } from './scoreboard-state';

const POLL_MS = 5_000;
/** При живом соединении — сверка со снимком раз в минуту (тихий обрыв ленты на сервере, смена номера ковра). */
const RESYNC_MS = 60_000;
const TICK_MS = 200;

const SIDE_STYLE: Record<Side, { panel: string; accent: string; win: string }> = {
  RED: { panel: 'bg-red-700', accent: 'bg-red-950/40', win: 'ring-red-300' },
  BLUE: { panel: 'bg-blue-700', accent: 'bg-blue-950/40', win: 'ring-blue-300' },
};

/** Снимок ковра по REST; `offsetMs` — смещение часов сервера по времени ответа (пока нет живого соединения). */
async function fetchState(
  matId: string,
): Promise<{ state: PublicMatStateDto; offsetMs: number } | 'not_found' | null> {
  try {
    const sentAt = Date.now();
    const res = await fetch(`/api/public/v1/mats/${matId}/scoreboard`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 404) return 'not_found';
    if (!res.ok) return null;
    const body = (await res.json()) as DataEnvelope<PublicMatStateDto>;
    const receivedAt = Date.now();
    return {
      state: body.data,
      offsetMs: Date.parse(body.data.serverTime) - Math.round((sentAt + receivedAt) / 2),
    };
  } catch {
    return null;
  }
}

/** Время сервера, тикающее на экране. */
function useServerNow(restOffset: number, online: boolean): number {
  const offset = online ? liveClient().offsetMs : restOffset;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + (online ? liveClient().offsetMs : restOffset)), TICK_MS);
    return () => clearInterval(id);
  }, [online, restOffset]);
  return now;
}

/** Экран не гаснет, пока открыто табло (где браузер это позволяет). */
function useWakeLock(): void {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async (): Promise<void> => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        const l = await nav.wakeLock?.request('screen');
        if (cancelled) void l?.release();
        else lock = l ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

function SideName({ side, info }: { side: Side; info: LiveSideDto }) {
  const t = useTranslations('scoreboard');
  const corner = t(side === 'RED' ? 'red' : 'blue');
  const name = info.name ?? (info.hidden ? corner : t('waiting'));
  return (
    <div className="min-w-0">
      <p className="truncate text-[min(3vh,2vw)] font-semibold uppercase tracking-widest text-white/70">
        {info.name ? corner : ' '}
      </p>
      <p className="truncate text-[min(8vh,4.6vw)] font-extrabold leading-tight">{name}</p>
      <p className="truncate text-[min(4vh,2.6vw)] font-medium text-white/85">{info.club ?? ' '}</p>
    </div>
  );
}

function SidePanel({
  side,
  match,
  showScore,
  winner,
}: {
  side: Side;
  match: LiveMatchDto;
  showScore: boolean;
  winner: boolean;
}) {
  const t = useTranslations('scoreboard');
  const label = useRefereeLabels();
  const info = side === 'RED' ? match.red : match.blue;
  const score = match.score ? (side === 'RED' ? match.score.red : match.score.blue) : null;
  const result = match.result;
  const finalPoints = result ? (side === 'RED' ? result.redScore : result.blueScore) : null;
  const points = finalPoints ?? score?.points ?? 0;
  const hold = match.hold?.side === side ? match.hold : null;
  const style = SIDE_STYLE[side];
  return (
    <section
      aria-label={t(side === 'RED' ? 'red' : 'blue')}
      className={cn(
        // Три строки: имя — сверху, баллы — всё оставшееся место, наказания и удержание — всегда видны снизу.
        'grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-[1.5vh] overflow-hidden p-[2.5vh_3vw]',
        style.panel,
        winner && `ring-[1.2vh] ring-inset ${style.win}`,
      )}
    >
      <SideName side={side} info={info} />
      {showScore ? (
        <p
          className="flex min-h-0 items-center justify-center text-[min(30vh,18vw)] font-black leading-none tabular-nums"
          aria-live="polite"
        >
          <span className="sr-only">{t('points')}: </span>
          {points}
        </p>
      ) : (
        <div />
      )}
      <div className="flex min-h-[6vh] flex-wrap items-center gap-[1vw]">
        {(score?.penalties ?? []).map((p, i) => (
          <span
            key={`${p}-${i}`}
            className="rounded-[0.6vh] bg-amber-300 px-[1vw] py-[0.4vh] text-[min(3.2vh,2vw)] font-bold text-slate-950"
          >
            {label.code(p)}
          </span>
        ))}
        {hold ? (
          // Подробно удержание — рядом с основным временем; здесь — только чей угол держит.
          <span
            className={cn(
              'rounded-[0.6vh] px-[1vw] py-[0.4vh] text-[min(3.2vh,2vw)] font-bold',
              style.accent,
            )}
          >
            {t('holdLabel')}
          </span>
        ) : null}
        {winner ? (
          <span className="rounded-[0.6vh] bg-white px-[1vw] py-[0.4vh] text-[min(4vh,2.6vw)] font-black text-slate-950">
            {t('winner')}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function MatchHeader({ match, status }: { match: LiveMatchDto; status: string }) {
  const t = useTranslations('scoreboard');
  const locale = useLocale();
  const round = useRoundLabel();
  return (
    <p className="truncate text-center text-[min(3.4vh,2.2vw)] font-semibold">
      {pickName(match.category, locale)} · {round(match.roundLabel)}
      {match.number !== null ? ` · ${t('match', { number: match.number })}` : ''}
      <span className="ml-[1.5vw] rounded-[0.6vh] bg-white px-[1vw] py-[0.3vh] text-slate-950">{status}</span>
    </p>
  );
}

function Clock({ match, serverNow }: { match: LiveMatchDto; serverNow: number }) {
  const t = useTranslations('scoreboard');
  if (!match.clock) return null;
  const elapsed = liveClockMs(match.clock, serverNow);
  const remaining = match.clock.durationMs - elapsed;
  const timeUp = remaining <= 0;
  const hold = match.hold;
  return (
    <div className="flex items-center justify-center gap-[4vw] bg-slate-950 py-[1.2vh]">
      <div className="flex flex-col items-center">
        <p
          role="timer"
          aria-live="off"
          className={cn(
            'text-[min(15vh,10vw)] font-black leading-none tabular-nums',
            match.clock.running ? 'text-white' : 'text-amber-300',
          )}
        >
          {formatClock(remaining)}
        </p>
        {timeUp && match.status !== 'FINISHED' ? (
          <p className="text-[min(3vh,2vw)] font-semibold text-amber-300">{t('timeUp')}</p>
        ) : null}
      </div>
      {hold ? (
        // Удержание — рядом с основным временем, цветом угла: его видно с любого места трибуны.
        <div
          className={cn(
            'flex flex-col items-center rounded-[1vh] px-[2vw] py-[0.8vh]',
            hold.side === 'RED' ? 'bg-red-700' : 'bg-blue-700',
          )}
        >
          <p className="text-[min(2.6vh,1.8vw)] font-semibold uppercase tracking-widest text-white/80">
            {t('holdLabel')}
          </p>
          <p className="text-[min(10vh,6.5vw)] font-black leading-none tabular-nums">
            {Math.floor(liveHoldMs(hold, serverNow) / 1000)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ResultLine({ match }: { match: LiveMatchDto }) {
  const t = useTranslations('scoreboard');
  const label = useRefereeLabels();
  const r = match.result;
  if (!r) return null;
  const winner = r.winnerSide
    ? ((r.winnerSide === 'RED' ? match.red : match.blue).name ?? t(r.winnerSide === 'RED' ? 'red' : 'blue'))
    : null;
  return (
    <div className="bg-slate-950 py-[2vh] text-center">
      <p className="text-[min(6vh,3.6vw)] font-extrabold">
        {winner ? `${t('winner')}: ${winner}` : t('noWinner')}
      </p>
      <p className="text-[min(3.6vh,2.4vw)] text-white/85">
        {label.method(r.method, r.methodDetail)}
        {r.status === 'PROVISIONAL' ? ` · ${t('provisional')}` : ''}
      </p>
    </div>
  );
}

function NextStrip({ match }: { match: LiveMatchDto }) {
  const t = useTranslations('scoreboard');
  const locale = useLocale();
  const name = (s: LiveSideDto, side: Side): string =>
    s.name ?? (s.hidden ? t(side === 'RED' ? 'red' : 'blue') : t('waiting'));
  return (
    <p className="truncate bg-slate-900 px-[3vw] py-[1.4vh] text-center text-[min(3.4vh,2.2vw)]">
      <span className="font-semibold uppercase tracking-wide text-white/70">{t('next')}:</span>{' '}
      <span className="font-bold text-red-300">{name(match.red, 'RED')}</span>
      {' — '}
      <span className="font-bold text-blue-300">{name(match.blue, 'BLUE')}</span>
      <span className="text-white/70"> · {pickName(match.category, locale)}</span>
    </p>
  );
}

/** Подпись состояния крупного экрана (ключ `scoreboard.status.*`). */
function statusKey(view: ScoreboardView): 'PAUSED' | 'IN_PROGRESS' | 'READY' | 'FINISHED' | 'NEXT' {
  if (view.kind === 'live') return view.match.status === 'PAUSED' ? 'PAUSED' : 'IN_PROGRESS';
  if (view.kind === 'called') return 'READY';
  if (view.kind === 'result') return 'FINISHED';
  return 'NEXT';
}

export function MatScoreboard({ matId }: { matId: string }) {
  const t = useTranslations('scoreboard');
  const [state, setState] = useState<PublicMatStateDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [restOffset, setRestOffset] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const live = useLiveStatus();
  const online = live === 'online';
  const loading = useRef(false);
  useWakeLock();

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const r = await fetchState(matId);
      if (r === 'not_found') setNotFound(true);
      else if (r) {
        setNotFound(false);
        setRestOffset(r.offsetMs);
        setState((prev) => mergeMatState(prev, r.state));
      }
    } finally {
      loading.current = false;
    }
  }, [matId]);

  useEffect(() => {
    void load();
  }, [load]);
  const channel = state?.channel ?? null;
  const health = useChannelHealth(channel);
  // Запасной опрос: пока канал табло не работает (сеть зала режет WebSocket, сервер перезапускается) — часто;
  // при живом канале — сверка раз в минуту.
  useEffect(() => {
    const id = setInterval(() => void load(), health === 'live' ? RESYNC_MS : POLL_MS);
    return () => clearInterval(id);
  }, [health, load]);

  /** Состояние из канала — только этого ковра (номер ковра мог смениться: канал тогда перечитывается). */
  const apply = (incoming: PublicMatStateDto): void => {
    if (incoming.mat.id !== matId) {
      void load();
      return;
    }
    setState((prev) => mergeMatState(prev, incoming));
  };
  useLiveChannel(channel, (e) => {
    if (e.kind === 'message' && e.message.type === 'mat.state') apply(e.message.payload as PublicMatStateDto);
    else if (e.kind === 'resync') {
      if (e.snapshot?.type === 'mat.state') apply(e.snapshot.payload as PublicMatStateDto);
      else void load();
    } else if (e.kind === 'error' && e.code === 'NOT_FOUND') setNotFound(true);
  });

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const serverNow = useServerNow(restOffset, online);
  // «В эфире» — канал табло работает, а не просто есть соединение.
  const onAir = health === 'live';

  if (notFound)
    return (
      <main className="theme-light flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-white">
        <p className="max-w-3xl text-2xl font-semibold">{t('notFound')}</p>
      </main>
    );
  if (!state)
    return (
      <main className="theme-light flex min-h-screen items-center justify-center bg-slate-950 text-2xl text-white/70">
        {t('loading')}
      </main>
    );

  const view = scoreboardView(state, serverNow);
  const next = upNext(state, view);
  const match = 'match' in view ? view.match : null;
  const winnerSide = view.kind === 'result' ? (view.match.result?.winnerSide ?? null) : null;
  return (
    <main className="theme-light flex h-screen min-h-[320px] select-none flex-col overflow-hidden bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-[2vw] bg-slate-900 px-[3vw] py-[1.2vh]">
        <p className="min-w-0 truncate text-[min(3.6vh,2.4vw)] font-bold">
          {t('mat', { number: state.mat.number })}
          {state.mat.name ? ` ${state.mat.name}` : ''}
          <span className="font-normal text-white/70"> · {state.competition.name}</span>
        </p>
        <div className="flex shrink-0 items-center gap-[1vw]">
          <span
            className={cn(
              'inline-flex items-center gap-[0.5vw] text-[min(2.4vh,1.6vw)]',
              onAir ? 'text-emerald-300' : 'text-amber-300',
            )}
            role="status"
          >
            <span
              aria-hidden="true"
              className={cn('h-[1.4vh] w-[1.4vh] rounded-full', onAir ? 'bg-emerald-400' : 'bg-amber-400')}
            />
            {onAir ? t('online') : t('offline')}
          </span>
          {!fullscreen ? (
            <button
              type="button"
              className="min-h-11 rounded-md border border-white/40 px-3 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
            >
              {t('fullscreen')}
            </button>
          ) : null}
        </div>
      </header>
      {match ? (
        <>
          <div className="bg-slate-900 px-[3vw] pb-[1.2vh]">
            <MatchHeader match={match} status={t(`status.${statusKey(view)}`)} />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-2">
            <SidePanel
              side="RED"
              match={match}
              showScore={view.kind !== 'next' && view.kind !== 'called'}
              winner={winnerSide === 'RED'}
            />
            <SidePanel
              side="BLUE"
              match={match}
              showScore={view.kind !== 'next' && view.kind !== 'called'}
              winner={winnerSide === 'BLUE'}
            />
          </div>
          {view.kind === 'result' ? (
            <ResultLine match={match} />
          ) : (
            <Clock match={match} serverNow={serverNow} />
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-[min(6vh,4vw)] font-bold text-white/80">{t('idle')}</p>
        </div>
      )}
      {next ? <NextStrip match={next} /> : null}
    </main>
  );
}
