import { EmptyState, PageHeader } from '@sde/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pathToSuccess');
  return { title: t('title') };
}

/** «Путь к успеху» спортсмена (правки 28.10.2026): содержание определит заказчик, пока раздел пустой. */
export default async function Page() {
  const t = await getTranslations('pathToSuccess');
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState title={t('empty')} />
    </>
  );
}
