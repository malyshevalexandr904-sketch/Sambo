'use client';
// Окна заявки на проведение турнира: «?» — как проходит турнир у стороннего организатора, и правила подачи заявки.
// Тексты — в словаре (competitionRequests.processText, competitionRequests.rulesText): их можно заменить, не трогая код.
import { Button } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useRef } from 'react';

function InfoDialog({
  id,
  title,
  text,
  trigger,
}: {
  id: string;
  title: string;
  text: string;
  trigger: (open: () => void) => ReactNode;
}) {
  const t = useTranslations('common');
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      {trigger(() => ref.current?.showModal())}
      <dialog
        ref={ref}
        aria-labelledby={`${id}-title`}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/60"
        onClick={(e) => {
          // Щелчок по затемнению закрывает окно.
          if (e.target === ref.current) ref.current.close();
        }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-3 max-h-[60vh] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-slate-700">
          {text}
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={() => ref.current?.close()}>
            {t('close')}
          </Button>
        </div>
      </dialog>
    </>
  );
}

/** Круглая кнопка «?» рядом с призывом подать заявку. */
export function HostingProcessButton() {
  const t = useTranslations('competitionRequests');
  return (
    <InfoDialog
      id="hosting-process"
      title={t('processTitle')}
      text={t('processText')}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          aria-label={t('processTitle')}
          title={t('processTitle')}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-blue-700 bg-white text-lg font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          ?
        </button>
      )}
    />
  );
}

/** Ссылка-кнопка «правила подачи заявки» внутри отметки согласия. */
export function HostingRulesLink({ children }: { children: ReactNode }) {
  const t = useTranslations('competitionRequests');
  return (
    <InfoDialog
      id="hosting-rules"
      title={t('rulesTitle')}
      text={t('rulesText')}
      trigger={(open) => (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            open();
          }}
          className="font-medium text-blue-700 underline hover:text-blue-800"
        >
          {children}
        </button>
      )}
    />
  );
}
