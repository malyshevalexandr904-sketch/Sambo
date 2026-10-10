'use client';
// Протокол категории (план Phase 7b, §5; макет согласован): итоговые места с медалями, затем все схватки по номерам
// (без соперника — курсивом), изменённые результаты — в пояснении; подписи главного судьи и главного секретаря.
import type { CategoryProtocolDto, CategoryProtocolMatchRow, Medal } from '@sde/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { useFormatLabel } from '@/features/draws/shared';
import { useRefereeLabels } from '@/features/refereeing/labels';
import { useRoundLabel } from '@/features/scheduling/shared';
import { pickName } from '@/lib/queries';
import { useCategoryProtocol } from './api';
import { DocHead, ProtocolFrame, Signatures, Toolbar, useDateTime, useNotFound } from './protocol-parts';

function MedalCell({ medal }: { medal: Medal | null }) {
  const t = useTranslations('results.medals');
  return medal ? <span className={`medal ${medal}`}>{t(medal)}</span> : null;
}

function BoutRow({ m }: { m: CategoryProtocolMatchRow }) {
  const t = useTranslations('protocols');
  const label = useRefereeLabels();
  const round = useRoundLabel();
  return (
    <tr className={m.noMatch ? 'nob' : ''}>
      <td className="num">
        {m.number ?? '—'}
        {m.amended ? '*' : ''}
      </td>
      <td className="narrow">{round(m.roundLabel)}</td>
      <td className={m.winnerSide === 'RED' ? 'w' : ''}>{m.red ?? '—'}</td>
      <td className={m.winnerSide === 'BLUE' ? 'w' : ''}>{m.blue ?? '—'}</td>
      <td className="c">
        {m.noMatch || m.method === null || m.method === 'BYE' || m.method === 'NO_SHOW'
          ? ''
          : `${m.redScore ?? 0} : ${m.blueScore ?? 0}`}
      </td>
      <td className="narrow">
        {m.method ? label.method(m.method, m.methodDetail) : m.noMatch ? t('notHeld') : t('notFinished')}
      </td>
    </tr>
  );
}

function CategorySheet({ p }: { p: CategoryProtocolDto }) {
  const t = useTranslations('protocols');
  const tStatus = useTranslations('results.statuses');
  const locale = useLocale();
  const label = useRefereeLabels();
  const formatLabel = useFormatLabel();
  const at = useDateTime(p.header.timezone);
  const amended = p.matches.filter((m) => m.amended);
  return (
    <article className="sheet" aria-label={t('categoryTitle')}>
      <DocHead header={p.header} title={t('categoryTitle').toUpperCase()} />
      <div className="meta">
        <div>
          <span className="k">{t('category')}</span>
          <span className="v">{pickName(p.categoryName, locale)}</span>
        </div>
        <div>
          <span className="k">{t('format')}</span>
          <span className="v narrow">{formatLabel(p.format)}</span>
        </div>
        <div>
          <span className="k">{t('participants')}</span>
          <span className="v">{p.participants}</span>
        </div>
        <div>
          <span className="k">{t('results')}</span>
          <span className="v">{p.resultStatus ? tStatus(p.resultStatus) : t('noResults')}</span>
        </div>
      </div>
      <p className="sec">{t('places')}</p>
      {p.places.length > 0 ? (
        <>
          <table className="places">
            <thead>
              <tr>
                <th className="c">{t('colPlace')}</th>
                <th>{t('colFullName')}</th>
                <th className="c">{t('colYear')}</th>
                <th>{t('colClub')}</th>
                <th className="c">{t('colWins')}</th>
                <th className="c">{t('colLosses')}</th>
                <th className="c">{t('colMedal')}</th>
              </tr>
            </thead>
            <tbody>
              {p.places.map((x) => (
                <tr key={x.entryId}>
                  <td className="place c">{x.place}</td>
                  <td>{x.fullName}</td>
                  <td className="c">{x.birthYear}</td>
                  <td className="narrow">{[x.club, x.region].filter(Boolean).join(', ')}</td>
                  <td className="c">{x.wins}</td>
                  <td className="c">{x.losses}</td>
                  <td className="c">
                    <MedalCell medal={x.medal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="legend">{t('placesLegend')}</p>
        </>
      ) : (
        <p className="facts">{t('noPlaces')}</p>
      )}
      <p className="sec">{t('bouts')}</p>
      <table className="bouts">
        <thead>
          <tr>
            <th className="num">№</th>
            <th>{t('round')}</th>
            <th>{t('colRed')}</th>
            <th>{t('colBlue')}</th>
            <th className="c">{t('score')}</th>
            <th>{t('method')}</th>
          </tr>
        </thead>
        <tbody>
          {p.matches.map((m) => (
            <BoutRow key={m.matchId} m={m} />
          ))}
        </tbody>
      </table>
      <p className="legend">
        {t('boutsLegend')}
        {amended.map((m) => {
          const a = m.amended!;
          const prev = a.previous;
          return (
            <span key={m.matchId}>
              {' '}
              {t('amendedRow', {
                number: m.number ?? '—',
                at: at(a.at),
                previous: prev.winnerSide
                  ? `${label.side(prev.winnerSide).toLowerCase()}, ${label.method(prev.method, prev.methodDetail).toLowerCase()} ${prev.redScore ?? 0} : ${prev.blueScore ?? 0}`
                  : label.method(prev.method).toLowerCase(),
                reason: a.reason,
              })}
            </span>
          );
        })}
      </p>
      <Signatures
        items={[
          { role: t('chiefReferee'), name: p.signatures.chiefReferee },
          { role: t('chiefSecretary'), name: p.signatures.chiefSecretary },
        ]}
      />
      <footer className="foot">
        <span>
          {t('footCategory', { code: p.categoryCode })}
          {p.publishedAt ? ` · ${t('footPublished', { at: at(p.publishedAt) })}` : ''} ·{' '}
          {t('footGenerated', { at: at(p.header.generatedAt) })}
        </span>
      </footer>
    </article>
  );
}

export function CategoryProtocolPage({ categoryId }: { categoryId: string }) {
  const query = useCategoryProtocol(categoryId);
  const missing = useNotFound(query.error);
  if (missing) return missing;
  return (
    <ProtocolFrame>
      <QueryState isPending={query.isPending} error={query.error}>
        {() => (
          <>
            <Toolbar />
            <div className="scroll">
              <CategorySheet p={query.data as CategoryProtocolDto} />
            </div>
          </>
        )}
      </QueryState>
    </ProtocolFrame>
  );
}
