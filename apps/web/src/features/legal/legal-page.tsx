// Страница юридического текста: заголовок, оператор, редакция, разделы (абзацы и списки).
import { PD_CONSENT_VERSION } from '@sde/contracts';
import { getLocale, getTranslations } from 'next-intl/server';
import type { LegalSection } from './texts';

export async function LegalDocument({ title, sections }: { title: string; sections: LegalSection[] }) {
  const t = await getTranslations('legal');
  const locale = await getLocale();
  return (
    <article className="max-w-3xl text-slate-800">
      <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('version', { version: PD_CONSENT_VERSION })}</p>
      {locale !== 'ru' ? <p className="mt-2 text-sm text-slate-600">{t('russianOnly')}</p> : null}
      {sections.map((s) => (
        <section key={s.title} className="mt-6">
          <h2 className="text-xl font-semibold text-slate-900">{s.title}</h2>
          {s.body.map((b, i) =>
            typeof b === 'string' ? (
              <p key={i} className="mt-2">
                {b}
              </p>
            ) : (
              <ul key={i} className="mt-2 list-disc space-y-1 pl-6">
                {b.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </article>
  );
}
