// Каталог permissions (PERMISSIONS.md, 3). Миграция данных синхронизирует его в таблицу `permission`.
// Строковые permissions вне этого каталога запрещены: тип PermissionCode выводится отсюда.

export type PermissionScope = 'PLATFORM' | 'ORGANIZATION' | 'COMPETITION';

interface PermissionDef {
  scopes: readonly PermissionScope[];
  description: string;
}

const P = 'PLATFORM' as const;
const O = 'ORGANIZATION' as const;
const C = 'COMPETITION' as const;

export const PERMISSIONS = {
  'platform.settings.manage': { scopes: [P], description: 'Системные настройки' },
  'user.view': { scopes: [P], description: 'Просмотр пользователей' },
  'user.manage': { scopes: [P], description: 'Блокировка и разблокировка пользователей' },
  'role.manage': { scopes: [P], description: 'Назначение и снятие платформенных ролей' },
  'dictionary.manage': { scopes: [P], description: 'Справочники' },
  'consent_template.manage': { scopes: [P], description: 'Тексты согласий' },
  'athlete.merge': { scopes: [P], description: 'Слияние дублей спортсменов' },
  'audit.view': { scopes: [P, C], description: 'Журнал аудита' },
  'organization.approve': { scopes: [P, O], description: 'Активация и приостановка организаций' },
  'organization.create_child': { scopes: [O], description: 'Создание дочерней организации' },
  'organization.update': { scopes: [O], description: 'Изменение данных организации' },
  'organization.members.view': { scopes: [O], description: 'Просмотр участников организации' },
  'organization.members.manage': { scopes: [O], description: 'Приглашение и исключение участников' },
  'athlete.view': { scopes: [O], description: 'Просмотр спортсменов организации' },
  'athlete.create': { scopes: [O], description: 'Создание спортсмена' },
  'athlete.update': { scopes: [O], description: 'Изменение спортсмена' },
  'athlete.archive': { scopes: [O], description: 'Архивирование спортсмена' },
  'athlete.import': { scopes: [O], description: 'Импорт спортсменов из файла' },
  'guardian.manage': { scopes: [O], description: 'Законные представители спортсмена' },
  'consent.record': { scopes: [O], description: 'Внесение бумажного согласия (скан)' },
  'coach.manage': { scopes: [O], description: 'Тренеры организации' },
  'referee.manage': { scopes: [O], description: 'Судьи и судейские категории' },
  'document.upload': { scopes: [O], description: 'Загрузка документов спортсмена' },
  'document.view': { scopes: [O, C], description: 'Просмотр документов' },
  'document.verify': { scopes: [C], description: 'Проверка документов' },
  'category.manage': { scopes: [P, O], description: 'Возрастные группы, весовые категории, шаблоны' },
  'ruleset.manage': { scopes: [P, O], description: 'Наборы правил и их версии' },
  'venue.manage': { scopes: [O], description: 'Места проведения' },
  'competition.create': { scopes: [O], description: 'Создание турнира от имени организации' },
  'registration.create': { scopes: [O], description: 'Подача заявок от имени организации' },
  'ranking.manage': { scopes: [O], description: 'Рейтинговые системы' },
  'competition.view': { scopes: [C], description: 'Служебные данные турнира' },
  'competition.update': { scopes: [C], description: 'Изменение турнира и положения' },
  'competition.delete': { scopes: [C], description: 'Удаление черновика турнира' },
  'competition.publish': { scopes: [C], description: 'Публикация турнира' },
  'competition.transition': { scopes: [C], description: 'Переходы статуса турнира' },
  'competition.members.manage': { scopes: [C], description: 'Персонал турнира' },
  'competition_category.manage': { scopes: [C], description: 'Категории турнира, правила, требования' },
  'category.merge': { scopes: [C], description: 'Объединение категорий' },
  'registration.view': { scopes: [C], description: 'Все заявки турнира' },
  'registration.approve': { scopes: [C], description: 'Одобрение участия' },
  'registration.reject': { scopes: [C], description: 'Отклонение участия' },
  'registration.return': { scopes: [C], description: 'Возврат заявки на исправление' },
  'registration.export': { scopes: [C], description: 'Выгрузка списка заявок' },
  'entry.withdraw': { scopes: [C], description: 'Снятие участника' },
  'entry.transfer': { scopes: [C], description: 'Перевод участника в другую категорию' },
  'admission.view': { scopes: [C], description: 'Статусы допуска' },
  'admission.override': { scopes: [C], description: 'Исключение из проверки допуска' },
  'checkin.view': { scopes: [C], description: 'Статусы прибытия' },
  'checkin.perform': { scopes: [C], description: 'Отметка прибытия' },
  'weighin.manage': { scopes: [C], description: 'Весы и окна взвешивания' },
  'weighin.record': { scopes: [C], description: 'Запись взвешивания' },
  'weighin.view': { scopes: [C], description: 'Результаты взвешивания' },
  'medical.view': { scopes: [C], description: 'Медицинские допуски и инциденты' },
  'medical.record': { scopes: [C], description: 'Запись медицинского допуска и инцидента' },
  'draw.create': { scopes: [C], description: 'Черновик жеребьёвки' },
  'draw.publish': { scopes: [C], description: 'Публикация жеребьёвки' },
  'draw.republish': { scopes: [C], description: 'Новая версия опубликованной жеребьёвки' },
  'mat.manage': { scopes: [C], description: 'Ковры' },
  'schedule.manage': { scopes: [C], description: 'Сессии и расписание' },
  'schedule.publish': { scopes: [C], description: 'Публикация расписания' },
  'mat_assignment.manage': { scopes: [C], description: 'Назначение бригад' },
  'match.create': { scopes: [C], description: 'Ручное создание схватки' },
  'match.update': { scopes: [C], description: 'Вызов, пауза, перенос схватки' },
  'match.start': { scopes: [C], description: 'Старт схватки' },
  'match.finish': { scopes: [C], description: 'Завершение схватки' },
  'match.cancel': { scopes: [C], description: 'Отмена схватки' },
  'scoring.create': { scopes: [C], description: 'Запись событий схватки' },
  'scoring.update': { scopes: [C], description: 'Аннулирование событий схватки' },
  'result.confirm': { scopes: [C], description: 'Подтверждение результата схватки' },
  'result.amend': { scopes: [C], description: 'Изменение подтверждённого результата' },
  'result.publish': { scopes: [C], description: 'Публикация результатов категории' },
  'team_standing.publish': { scopes: [C], description: 'Публикация командного зачёта' },
  'export.create': { scopes: [C], description: 'Выгрузки и печатные формы' },
  'notification.announce': { scopes: [C], description: 'Объявления участникам' },
  'venue_node.manage': { scopes: [C], description: 'Площадочный узел' },
  'write_lease.recover': { scopes: [C], description: 'Аварийный возврат права записи' },
} as const satisfies Record<string, PermissionDef>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function permissionModule(code: PermissionCode): string {
  return code.split('.')[0] ?? code;
}

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
