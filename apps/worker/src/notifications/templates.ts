// Письма уведомлений по локалям (DATABASE.md, 3.8). В письмах нет ПДн детей (SECURITY.md, 3.7): имя спортсмена
// показывается только в ленте приложения, куда пользователь входит с проверкой прав.
import type { Locale, NotificationType } from '@sde/contracts';
import { type RenderedEmail, renderDefinition, type TemplateDef } from '../email/templates';

const STATUS: Record<Locale, Record<string, string>> = {
  ru: { APPROVED: 'одобрена', REJECTED: 'отклонена' },
  en: { APPROVED: 'approved', REJECTED: 'rejected' },
};

const TEMPLATES: Record<Locale, Record<NotificationType, TemplateDef>> = {
  ru: {
    'application.returned': {
      subject: 'Заявка возвращена на исправление — SAMBO Digital',
      lines: [
        'Заявка {organizationName} на турнир «{competitionName}» возвращена на исправление.',
        'Комментарий секретариата: {reason}',
        'Исправьте заявку и подайте её снова.',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'application.decided': {
      subject: 'Заявка {statusText} — SAMBO Digital',
      lines: [
        'Заявка {organizationName} на турнир «{competitionName}» {statusText}.',
        'Комментарий секретариата: {reason}',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'statusText', 'url'],
    },
    'entry.rejected': {
      subject: 'Участие отклонено — SAMBO Digital',
      lines: [
        'В заявке {organizationName} на турнир «{competitionName}» отклонено участие спортсмена.',
        'Причина: {reason}',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'document.rejected': {
      subject: 'Документ отклонён — SAMBO Digital',
      lines: [
        'Загруженный вами документ «{documentType}» отклонён при проверке.',
        'Причина: {reason}',
        'Загрузите исправленный документ в разделе «Документы».',
      ],
      action: { label: 'Перейти к документам', param: 'url' },
      required: ['documentType', 'url'],
    },
  },
  en: {
    'application.returned': {
      subject: 'Application returned for correction — SAMBO Digital',
      lines: [
        'The application of {organizationName} for “{competitionName}” has been returned for correction.',
        'Secretariat comment: {reason}',
        'Please correct the application and submit it again.',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'application.decided': {
      subject: 'Application {statusText} — SAMBO Digital',
      lines: [
        'The application of {organizationName} for “{competitionName}” has been {statusText}.',
        'Secretariat comment: {reason}',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'statusText', 'url'],
    },
    'entry.rejected': {
      subject: 'Entry rejected — SAMBO Digital',
      lines: [
        'An athlete entry in the application of {organizationName} for “{competitionName}” has been rejected.',
        'Reason: {reason}',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'document.rejected': {
      subject: 'Document rejected — SAMBO Digital',
      lines: [
        'The document “{documentType}” you uploaded was rejected during review.',
        'Reason: {reason}',
        'Please upload a corrected document in the Documents section.',
      ],
      action: { label: 'Open documents', param: 'url' },
      required: ['documentType', 'url'],
    },
  },
};

export function renderNotificationEmail(
  type: NotificationType,
  locale: Locale,
  params: Record<string, string>,
): RenderedEmail {
  const statusText = params.status ? (STATUS[locale][params.status] ?? params.status) : '';
  return renderDefinition(TEMPLATES[locale][type], `notification:${type}`, locale, { ...params, statusText });
}
