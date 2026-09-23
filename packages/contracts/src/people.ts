// Person — минимальный набор Phase 2 (API.md, 3.2 и 4.1).
import { z } from 'zod';
import { CountryCode, LocalDate, PersonName, Uuid } from './common.js';

export const GENDERS = ['MALE', 'FEMALE'] as const;
export type Gender = (typeof GENDERS)[number];

export const PersonInput = z.object({
  lastName: PersonName,
  firstName: PersonName,
  middleName: PersonName.optional(),
  birthDate: LocalDate.refine((d) => d > '1900-01-01' && d <= new Date().toISOString().slice(0, 10), {
    error: 'birth_date_out_of_range',
  }),
  gender: z.enum(GENDERS),
  countryCode: CountryCode.optional(),
  regionId: Uuid.optional(),
  city: z.string().trim().max(100).optional(),
});
export type PersonInput = z.infer<typeof PersonInput>;

export const UpsertMyPersonRequest = PersonInput.extend({
  /** Пользователь подтверждает, что похожая запись — не он (API.md, 3.2: POSSIBLE_DUPLICATE). */
  confirmNotDuplicate: z.boolean().optional(),
});
export type UpsertMyPersonRequest = z.infer<typeof UpsertMyPersonRequest>;

export interface PersonDto {
  id: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  gender: Gender;
  countryCode: string | null;
  regionId: string | null;
  city: string | null;
}
