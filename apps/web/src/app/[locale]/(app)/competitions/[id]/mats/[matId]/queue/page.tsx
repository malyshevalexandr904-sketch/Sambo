import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { MatQueuePage } from '@/features/scheduling/mat-queue-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('scheduling.queue');
  return { title: t('screenTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string; matId: string }> }) {
  const { id, matId } = await params;
  return (
    <Suspense>
      <MatQueuePage competitionId={id} matId={matId} />
    </Suspense>
  );
}
