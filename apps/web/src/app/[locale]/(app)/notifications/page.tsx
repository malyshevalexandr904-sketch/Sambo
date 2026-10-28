import { redirect } from '@/i18n/navigation';

/** Уведомления перенесены в «Настройки» (правки 28.10.2026): старые ссылки (письма, push) ведут туда. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: '/settings', locale });
}
