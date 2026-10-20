# Рейтинг: критерии приёмки и тесты

Сверка критериев приёмки ТЗ (п. 76) с автоматическими тестами (фаза 16). Пути — от корня репозитория;
`*.e2e.test.ts` — интеграционные тесты на реальных PostgreSQL и Redis (`pnpm test:integration`), остальные —
модульные (`pnpm test`). Все они выполняются в CI на каждый PR.

Сквозной сценарий рейтингового турнира — `apps/api/test/rated-tournament.e2e.test.ts`:

1. Руководитель, секретарь и главный судья турнира получают 403. Администратор платформы делает турнир рейтинговым,
   указывая причину, и закрепляет действующую версию правил.
2. Жеребьёвка 8 участников даёт две подгруппы по 4: посев идёт змейкой по рейтингу на момент жеребьёвки, посев и
   рейтинг каждого участника сохраняются.
3. Судьи проводят 12 схваток подгрупп. После подтверждения каждой схватки рейтинг считается по событию outbox так же,
   как в worker: тот же `@sde/rating`, та же роль БД приложения.
4. Финальная часть заполняется местами подгрупп; полуфиналы и финал сыграны. Места категории: 1, 2, два 3-х, 5, 5,
   7, 7.
5. 15 расчётов, по одному на схватку. Повтор всех событий не добавляет ни одного. Сходятся 30 строк истории, цепочка
   «рейтинг до = рейтинг после предыдущей схватки», уровни, победы и поражения, лучший рейтинг, аудит
   `rating.calculated`.
6. Пересборка каждого из 8 спортсменов не находит расхождения.
7. Публичные страницы показывают турнир (изменения рейтинга), таблицу рейтинга и карточку спортсмена.
8. После расчётов тип турнира не меняется (422 `RATING_CALCULATIONS_EXIST`).
9. Новая версия правил (K вдвое больше) действует только на новый турнир. История прежнего турнира не меняется, его
   пересборка по-прежнему без расхождения.
10. Нерейтинговый турнир того же вида не меняет ни одного рейтинга.

| № | Критерий | Где проверено |
| --- | --- | --- |
| 1 | Обычный ORGANIZER не может создать RATED tournament | `apps/api/test/competition-type.e2e.test.ts` — «an organizer creates only non-rated competitions…»; сквозной сценарий, шаг 1 |
| 2 | Только PLATFORM_ADMIN / SUPER_ADMIN создаёт RATED tournament | `competition-type.e2e.test.ts` — создание, включение до публикации, процедура смены типа после публикации; матрица прав — `packages/contracts/src/roles.test.ts` — «rating permissions are platform-only…» |
| 3 | Остальные турниры автоматически NON_RATED | `competition-type.e2e.test.ts` — тип по умолчанию и отказ без права; ограничение БД `competition_type_guard` |
| 4 | NON_RATED не меняет Elo | `apps/api/test/rating.e2e.test.ts` — «writes nothing for a match of a competition that is not rated»; `apps/worker/test/rating.e2e.test.ts`; сквозной сценарий, шаг 10 |
| 5 | RATED меняет Elo после подтверждения каждого результата | `apps/worker/test/rating.e2e.test.ts` (событие → расчёт); сквозной сценарий, шаги 3–5 |
| 6 | Один матч нельзя применить к рейтингу дважды | `rating.e2e.test.ts` — «rates a refereed match once…», «counts concurrent calls for the same match once»; сквозной сценарий, шаг 5 |
| 7 | Рейтинг имеет историю | `rating.e2e.test.ts`; `apps/api/test/rankings.e2e.test.ts` (публичная история, график); сквозной сценарий, шаг 5 |
| 8 | Рейтинг можно проверить и восстановить | `apps/api/test/rating-admin.e2e.test.ts` — отчёт пересборки и применение; `packages/rating/src/rebuild.test.ts`; сквозной сценарий, шаг 6 |
| 9 | Уровень 1–10 вычисляется автоматически | `packages/rating/src/elo.test.ts` — «levels…»; сквозной сценарий, шаг 5 (`levelAfter` каждой строки) |
| 10 | Формула покрыта unit tests | `elo.test.ts` — контрольные значения Excel (Приложение 5), свойства формулы |
| 11 | K-factor покрыт unit tests | `elo.test.ts` — «K: 60 up to 100, 30 up to 300, 10 above» |
| 12 | Все коэффициенты результата покрыты unit tests | `elo.test.ts` — «every result coefficient S of Appendix 5 reaches the formula», симметрия S, классификатор исходов по правилам № 892 |
| 13 | Расчёт транзакционный | `rating.e2e.test.ts` — расчёт, история, текущие рейтинги, аудит и событие одной транзакцией; параллельные вызовы |
| 14 | История неизменяема обычными пользователями | `rating.e2e.test.ts` — «gives the application no way to rewrite or delete history» (нет UPDATE/DELETE у роли приложения); корректировки — новые строки (`rating-admin.e2e.test.ts`) |
| 15 | Специальная схема групп | `packages/contracts/src/rated-format.test.ts`; `apps/api/test/rated-format.e2e.test.ts`; сквозной сценарий, шаги 2–4 |
| 16 | 3–72 спортсмена | 3–39 — `rated-format.test.ts`, `apps/api/src/modules/brackets/domain/rated-groups.test.ts` (каждый размер). **40 и более не поддерживаются по решению заказчика от 2026-10-19 («сетки для 40+ пока не делаем»)**: 422 `TOO_MANY_PARTICIPANTS` |
| 17 | 6–11 — 2 группы | `rated-format.test.ts` — «6–11: two groups…»; сквозной сценарий (8 участников) |
| 18 | 12–23 — 4 группы | `rated-format.test.ts` — «12–23: four groups…» |
| 19 | 24–72 — 8 групп | 24–39 — `rated-format.test.ts` — «24–39: eight groups…»; 40–72 — см. п. 16 |
| 20 | Финальная часть генерируется автоматически | `brackets/domain/rated-groups.test.ts`; `rated-format.e2e.test.ts` — «fills the final part from the group places…»; сквозной сценарий, шаг 4 |
| 21 | Seed и rating snapshot сохраняются | `rated-format.e2e.test.ts` — «seeds by rating at the draw… and keeps the seed» (посев не меняется, триггер БД); сквозной сценарий, шаг 2 |
| 22 | Все административные изменения логируются | `competition-type.e2e.test.ts` (`competition.type_changed`); `rating-admin.e2e.test.ts` (корректировка, статус, пересборка, перерасчёт); `apps/api/test/rating-seasons.e2e.test.ts` (сезоны) |
| 23 | Старые рейтинги не пересчитываются новой формулой | `rating.e2e.test.ts` — действующая версия правил не меняется (триггер); сквозной сценарий, шаг 9 |
| 24–28 | Build, TypeScript, lint, unit, integration | CI: «Lint, typecheck, unit tests, build», «Integration tests (PostgreSQL, Redis)», «Docker images» |
| 29 | E2E сценарий рейтингового турнира | `apps/api/test/rated-tournament.e2e.test.ts` |

## Отступления и открытые решения

- **40–72 участника.** Не поддерживаются по решению заказчика (2026-10-19): жеребьёвка отклоняется с понятной
  ошибкой. Если такие сетки понадобятся, нужна версия формата и правило мест для 40+.
- **Порядок сезонной таблицы** (ТЗ 68): по рейтингу на конец сезона, утвердил заказчик 2026-10-20.
- **Статусы рейтинга FROZEN и SUSPENDED** (ТЗ 67). Сейчас при них расчёты только ждут; других последствий нет до
  решения заказчика.
