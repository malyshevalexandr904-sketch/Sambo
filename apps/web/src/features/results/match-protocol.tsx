'use client';
// Протокол схватки (план Phase 7b, §5; макет согласован): шапка, данные схватки, углы с полными ФИО, ход схватки по
// секундомеру (отменённое — зачёркнуто, с причиной; врач на ковре — строкой), итог, факты, подписи судьи и
// руководителя ковра.
import {
  formatMatchClock,
  type MatchProtocolDto,
  type ProtocolEventRow,
  type ProtocolParticipant,
  type Side,
} from '@sde/contracts';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { QueryState } from '@/components/common';
import { useRefereeLabels } from '@/features/refereeing/labels';
import { useRoundLabel } from '@/features/scheduling/shared';
import { pickName } from '@/lib/queries';
import { useMatchProtocol } from './api';
import { protocolLog } from './protocol-log';
import { DocHead, ProtocolFrame, Signatures, Toolbar, useDateTime, useNotFound } from './protocol-parts';

function Corner({ side, p }: { side: Side; p: ProtocolParticipant | null }) {
  const t = useTranslations('protocols');
  const locale = useLocale();
  return (
    <div className="corner">
      <span className="side">
        <span className={`chip ${side === 'RED' ? 'red' : 'blue'}`} />
        {t(side === 'RED' ? 'redCorner' : 'blueCorner')}
      </span>
      {p ? (
        <>
          <span className="name">{p.fullName}</span>
          <span className="line">
            {t('born', { year: p.birthYear })} · {p.rank ? pickName(p.rank, locale) : t('noRank')}
          </span>
          <span className="line">{[p.club, p.region].filter(Boolean).join(' · ') || '—'}</span>
        </>
      ) : (
        <span className="name">—</span>
      )}
    </div>
  );
}

type LogRow = {
  key: string;
  time: number;
  cls: string;
  side: Side | null;
  what: ReactNode;
  pts: string;
  score: string;
};

/** Строки журнала для протокола: время, угол, действие, баллы, счёт; врач на ковре — отдельной строкой. */
function useLogRows(p: MatchProtocolDto): LogRow[] {
  const t = useTranslations('protocols');
  const label = useRefereeLabels();
  const tDoc = useTranslations('referee.doctor');
  const durationMs = (p.durationSeconds ?? 0) * 1000;
  const describe = (e: ProtocolEventRow): string => {
    if (e.type === 'SCORE') return label.code(e.actionCode);
    if (e.type === 'PENALTY') {
      const name = t('penalty', { name: label.code(e.actionCode).toLowerCase() });
      return e.points ? `${name} (${t('toOpponent', { points: e.points })})` : name;
    }
    if (e.type === 'HOLD_ENDED') {
      const start = e.matchClockMs - (e.value ?? 0);
      return t('hold', {
        seconds: Math.round((e.value ?? 0) / 1000),
        from: formatMatchClock(Math.max(0, start)),
        to: formatMatchClock(e.matchClockMs),
      });
    }
    if (e.type === 'CLOCK_STARTED') return t('clockStarted');
    return durationMs > 0 && e.matchClockMs >= durationMs ? t('timeUp') : t('clockStopped');
  };
  return protocolLog(p).map((item) => {
    if (item.kind === 'incident') {
      const i = item.incident;
      return {
        key: item.key,
        time: item.time,
        cls: 'mark',
        side: null,
        what: t('doctorRow', {
          side: label.side(i.side).toLowerCase(),
          kind: tDoc(`kinds.${i.kind}`).toLowerCase(),
          decision: tDoc(`decisions.${i.decision}`).toLowerCase(),
        }),
        pts: '',
        score: item.score,
      };
    }
    const e = item.event;
    const what = e.voided ? (
      <>
        <span className="what">{describe(e)}</span>{' '}
        <span className="note">
          — {t('voided', { at: e.voidedAtMs !== null ? formatMatchClock(e.voidedAtMs) : '—' })}
          {e.voidReason ? `: ${e.voidReason}` : ''}
        </span>
      </>
    ) : (
      <span className="what">{describe(e)}</span>
    );
    return {
      key: item.key,
      time: item.time,
      cls: e.voided ? 'void' : item.mark ? 'mark' : '',
      side: item.mark ? null : e.side,
      what,
      pts:
        e.voided || item.mark ? '' : e.type === 'PENALTY' ? '—' : e.points !== null ? String(e.points) : '—',
      score: item.score,
    };
  });
}

function MatchSheet({ p }: { p: MatchProtocolDto }) {
  const t = useTranslations('protocols');
  const tDoc = useTranslations('referee.doctor');
  const locale = useLocale();
  const label = useRefereeLabels();
  const round = useRoundLabel();
  const at = useDateTime(p.header.timezone);
  const rows = useLogRows(p);
  const r = p.result;
  const person = (s: Side): ProtocolParticipant | null => (s === 'RED' ? p.red : p.blue);
  const penalties = (codes: string[]): string =>
    codes.length > 0 ? codes.map((c) => label.code(c).toLowerCase()).join(', ') : t('none');
  const time =
    p.startedAt && p.finishedAt
      ? `${at(p.startedAt, false)}–${at(p.finishedAt, false)}`
      : p.startedAt
        ? at(p.startedAt, false)
        : '—';
  const last = p.revisions[p.revisions.length - 1];
  return (
    <article className="sheet" aria-label={t('matchTitlePlain')}>
      <DocHead
        header={p.header}
        title={p.number !== null ? t('matchTitle', { number: p.number }) : t('matchTitlePlain').toUpperCase()}
      />
      <div className="meta">
        <div>
          <span className="k">{t('category')}</span>
          <span className="v">{pickName(p.categoryName, locale)}</span>
        </div>
        <div>
          <span className="k">{t('round')}</span>
          <span className="v">
            {round(p.roundLabel)}
            {p.manual ? ` (${t('manual')})` : ''}
          </span>
        </div>
        <div>
          <span className="k">{t('mat')}</span>
          <span className="v">{p.mat ? `№ ${p.mat.number}` : '—'}</span>
        </div>
        <div>
          <span className="k">{t('time')}</span>
          <span className="v">{time}</span>
        </div>
      </div>
      <div className="corners">
        <Corner side="RED" p={p.red} />
        <Corner side="BLUE" p={p.blue} />
      </div>
      <p className="sec">{t('course')}</p>
      {rows.length > 0 ? (
        <table className="log">
          <thead>
            <tr>
              <th className="num">{t('colTime')}</th>
              <th>{t('colCorner')}</th>
              <th>{t('colAction')}</th>
              <th className="c">{t('colPoints')}</th>
              <th className="c">{t('colScore')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.cls}>
                <td className="num">{formatMatchClock(row.time)}</td>
                <td>{row.side ? label.side(row.side) : ''}</td>
                <td>{row.what}</td>
                <td className="c">{row.pts}</td>
                <td className="c">{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="facts">{t('noEvents')}</p>
      )}
      <div className="result" aria-label={t('outcome')}>
        <div>
          <span className="k">{t('winner')}</span>
          <span className="v">
            {r?.winnerSide
              ? `${label.side(r.winnerSide)} — ${person(r.winnerSide)?.publicName ?? ''}`
              : r
                ? t('noWinner')
                : '—'}
          </span>
        </div>
        <div>
          <span className="k">{t('method')}</span>
          <span className="v">{r ? label.method(r.method, r.methodDetail) : '—'}</span>
        </div>
        <div>
          <span className="k">{t('score')}</span>
          <span className="v score">{r ? `${r.redScore ?? 0} : ${r.blueScore ?? 0}` : '—'}</span>
        </div>
      </div>
      <div className="facts">
        <p>
          <b>{t('penaltiesLabel')}:</b> {t('redShort')} — {penalties(p.penalties.red)}; {t('blueShort')} —{' '}
          {penalties(p.penalties.blue)}.
        </p>
        {p.incidents.length > 0 ? (
          <p>
            <b>{t('doctorLabel')}:</b>{' '}
            {p.incidents
              .map(
                (i) =>
                  `${i.matchClockMs !== null ? `${formatMatchClock(i.matchClockMs)}, ` : ''}${t('cornerOf', { side: label.side(i.side).toLowerCase() })} — ${tDoc(`kinds.${i.kind}`).toLowerCase()}, ${tDoc(`decisions.${i.decision}`).toLowerCase()}${i.recordedBy ? ` (${i.recordedBy.displayName})` : ''}`,
              )
              .join('; ')}
            .
          </p>
        ) : null}
        {r ? (
          <p>
            <b>{t('resultLabel')}:</b>{' '}
            {r.proposedAt
              ? t('recorded', { at: at(r.proposedAt, false), by: r.proposedBy?.displayName ?? '—' })
              : t('recordedBySystem')}
            {r.confirmedAt
              ? `, ${t('confirmed', { at: at(r.confirmedAt, false), by: r.confirmedBy?.displayName ?? '—' })}`
              : `, ${t('notConfirmed')}`}
            .{' '}
            {last
              ? t('amended', {
                  at: at(last.changedAt),
                  by: last.changedBy?.displayName ?? '—',
                  previous: last.winnerSide
                    ? `${label.side(last.winnerSide).toLowerCase()}, ${label.method(last.method, last.methodDetail).toLowerCase()} ${last.redScore ?? 0} : ${last.blueScore ?? 0}`
                    : label.method(last.method).toLowerCase(),
                  reason: last.reason,
                })
              : t('noChanges')}
          </p>
        ) : null}
      </div>
      <Signatures
        items={[
          { role: t('referee'), name: p.signatures.referee },
          { role: t('matChief'), name: p.signatures.matChief },
        ]}
      />
      <footer className="foot">
        <span>{t('footMatch', { publicId: p.publicId, at: at(p.header.generatedAt) })}</span>
      </footer>
    </article>
  );
}

export function MatchProtocolPage({ matchId }: { matchId: string }) {
  const query = useMatchProtocol(matchId);
  const missing = useNotFound(query.error);
  if (missing) return missing;
  return (
    <ProtocolFrame>
      <QueryState isPending={query.isPending} error={query.error}>
        {() => (
          <>
            <Toolbar />
            <div className="scroll">
              <MatchSheet p={query.data as MatchProtocolDto} />
            </div>
          </>
        )}
      </QueryState>
    </ProtocolFrame>
  );
}
