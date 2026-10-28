import { redirect } from '@/i18n/navigation';

/** «Мой профиль» перенесён в личный кабинет (правки 27.10.2026): старые ссылки ведут туда. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: '/admin', locale });
}
