// Открытый набор судей (правки 27.10.2026): должности и требования, которые организатор указывает при создании турнира.
// Отдельно от referee-recruitment.ts: схема создания турнира (competitions.ts) берёт их отсюда без цикла импортов.
import { z } from 'zod';
import { CABINET_ROLE_GRANTS } from './cabinet-roles.js';
import type { RoleCode } from './roles.js';

/** Должности набора — роли персонала турнира, которые действуют в роли кабинета «Судья». */
export const RECRUITMENT_ROLE_CODES: readonly RoleCode[] = CABINET_ROLE_GRANTS.REFEREE;

export const REFEREE_RECRUITMENT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type RefereeRecruitmentStatus = (typeof REFEREE_RECRUITMENT_STATUSES)[number];

export const REFEREE_APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RefereeApplicationStatus = (typeof REFEREE_APPLICATION_STATUSES)[number];

export const RECRUITMENT_REQUIREMENTS_MAX = 2000;

/** Должность в наборе: роль и требования организатора к кандидатам на неё. */
export const RefereeRecruitmentPositionInput = z.object({
  roleCode: z.enum(RECRUITMENT_ROLE_CODES as [RoleCode, ...RoleCode[]]),
  requirements: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(RECRUITMENT_REQUIREMENTS_MAX, { error: 'too_long' }),
});
export type RefereeRecruitmentPositionInput = z.infer<typeof RefereeRecruitmentPositionInput>;

/** Набор при создании турнира: список должностей (пустой или не указан — набора нет). */
export const RefereeRecruitmentInput = z
  .array(RefereeRecruitmentPositionInput)
  .max(20, { error: 'too_many' });
