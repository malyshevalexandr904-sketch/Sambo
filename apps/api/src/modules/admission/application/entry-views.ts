// Общие представления участия для списков допуска, прибытия, взвешивания и медицины: спортсмен из снимка
// участия (ADR-10), организация заявки, категория.
import type { AthleteBrief, CategoryRef, OrganizationRef } from '@sde/contracts';
import type { Prisma } from '@sde/db';

export const ENTRY_VIEW_SELECT = {
  id: true,
  competitionId: true,
  athleteId: true,
  applicationId: true,
  categoryId: true,
  status: true,
  snapLastName: true,
  snapFirstName: true,
  snapMiddleName: true,
  snapBirthDate: true,
  publicName: true,
  declaredWeightGrams: true,
  category: { select: { id: true, code: true, nameRu: true, nameEn: true } },
  application: { select: { organization: { select: { id: true, name: true, shortName: true } } } },
} satisfies Prisma.EntrySelect;

export type EntryView = Prisma.EntryGetPayload<{ select: typeof ENTRY_VIEW_SELECT }>;

export const toAthleteBrief = (e: EntryView): AthleteBrief => ({
  id: e.athleteId,
  lastName: e.snapLastName,
  firstName: e.snapFirstName,
  middleName: e.snapMiddleName,
  birthDate: e.snapBirthDate.toISOString().slice(0, 10),
  publicName: e.publicName,
});

export const toCategoryRef = (c: {
  id: string;
  code: string;
  nameRu: string;
  nameEn: string;
}): CategoryRef => ({
  id: c.id,
  code: c.code,
  name: { ru: c.nameRu, en: c.nameEn },
});

export const organizationOf = (e: EntryView): OrganizationRef => e.application.organization;

/** Поиск по фамилии, имени и клубу снимка. */
export const entrySearch = (q: string | undefined): Prisma.EntryWhereInput[] =>
  q
    ? [
        {
          OR: [
            { snapLastName: { contains: q, mode: 'insensitive' } },
            { snapFirstName: { contains: q, mode: 'insensitive' } },
            { snapClubName: { contains: q, mode: 'insensitive' } },
          ],
        },
      ]
    : [];

/** Курсор списков участий: по фамилии, затем по id. */
export const entryCursor = (cursor: { k: string; id: string } | null): Prisma.EntryWhereInput[] =>
  cursor
    ? [{ OR: [{ snapLastName: { gt: cursor.k } }, { snapLastName: cursor.k, id: { gt: cursor.id } }] }]
    : [];
