// Люди (DATABASE.md, 3.3): создание и изменение Person, поиск дублей (G-08), привязка к аккаунту, слияние.
// Модуль — владелец таблицы person; профили (спортсмен, тренер, судья) ссылаются на неё.
import { Injectable } from '@nestjs/common';
import { type DuplicateCandidate, type PersonDto, type PersonInput, type PersonPatch } from '@sde/contracts';
import { findAthleteDuplicates, findExactPersons, type Person, type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

export function personDto(p: Person): PersonDto {
  return {
    id: p.id,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName,
    birthDate: p.birthDate.toISOString().slice(0, 10),
    gender: p.gender,
    countryCode: p.countryCode,
    regionId: p.regionId,
    city: p.city,
  };
}

/** Представление Person для аудита: ФИО и дата рождения заменяются отметкой в redact (ARCHITECTURE.md, 11). */
export const personAudit = (p: Person): Record<string, unknown> =>
  personDto(p) as unknown as Record<string, unknown>;

/** Перенос ссылок на человека в таблицах модуля при слиянии двух записей одного человека. */
export type PersonMergeHandler = (tx: Tx, fromPersonId: string, toPersonId: string) => Promise<void>;

@Injectable()
export class PeopleService {
  private readonly mergeHandlers: PersonMergeHandler[] = [];

  /** Страна и регион — из справочников; регион должен принадлежать стране. Возвращает страну (из региона, если не задана). */
  async assertPlace(
    tx: Tx,
    countryCode: string | null | undefined,
    regionId: string | null | undefined,
    prefix: string,
  ): Promise<string | null> {
    if (countryCode && !(await tx.country.findUnique({ where: { code: countryCode } }))) {
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: `${prefix}countryCode`, code: 'invalid_country' }],
      });
    }
    if (!regionId) return countryCode ?? null;
    const region = await tx.region.findUnique({ where: { id: regionId } });
    if (!region || (countryCode && region.countryCode !== countryCode)) {
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: `${prefix}regionId`, code: 'invalid_region' }],
      });
    }
    return region.countryCode;
  }

  async create(tx: Tx, input: PersonInput, createdById: string | null, prefix = 'person.'): Promise<Person> {
    const countryCode = await this.assertPlace(tx, input.countryCode, input.regionId, prefix);
    return tx.person.create({
      data: {
        id: uuidv7(),
        lastName: input.lastName,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        birthDate: toDate(input.birthDate),
        gender: input.gender,
        countryCode,
        regionId: input.regionId ?? null,
        city: input.city ?? null,
        createdById,
      },
    });
  }

  async update(
    tx: Tx,
    personId: string,
    patch: PersonPatch,
    prefix = 'person.',
  ): Promise<{ before: Person; after: Person }> {
    const before = await tx.person.findUniqueOrThrow({ where: { id: personId } });
    const countryCode = patch.countryCode !== undefined ? patch.countryCode : before.countryCode;
    const regionId = patch.regionId !== undefined ? patch.regionId : before.regionId;
    const placeChanged = patch.countryCode !== undefined || patch.regionId !== undefined;
    const resolvedCountry = placeChanged
      ? await this.assertPlace(tx, countryCode, regionId, prefix)
      : undefined;
    const after = await tx.person.update({
      where: { id: personId },
      data: {
        lastName: patch.lastName,
        firstName: patch.firstName,
        middleName: patch.middleName,
        birthDate: patch.birthDate ? toDate(patch.birthDate) : undefined,
        gender: patch.gender,
        countryCode: placeChanged ? resolvedCountry : undefined,
        regionId: patch.regionId,
        city: patch.city,
      },
    });
    return { before, after };
  }

  /** Кандидаты-дубли среди спортсменов, в публичном виде (Q-04). */
  athleteDuplicates(
    tx: Tx,
    person: { lastName: string; firstName: string; birthDate: string },
    excludeAthleteId?: string,
  ): Promise<DuplicateCandidate[]> {
    return findAthleteDuplicates(tx, person, { excludeAthleteId });
  }

  /** Люди с тем же ФИО и датой рождения. */
  exactMatches(
    tx: Tx,
    person: { lastName: string; firstName: string; middleName?: string | null; birthDate: string },
    opts: { excludePersonId?: string | null; matchMiddleName?: boolean } = {},
  ): Promise<string[]> {
    return findExactPersons(tx, person, opts);
  }

  /** Человек пользователя: для тренеров, судей и представителей профиль строится на нём. */
  async personOfUser(tx: Tx, userId: string): Promise<Person | null> {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { person: true } });
    return user?.person ?? null;
  }

  /**
   * Привязка аккаунта к записи человека, созданной другим (представитель, которого внёс тренер).
   * Если у пользователя уже есть своя запись, ссылки переносятся на неё, а внесённая помечается слитой.
   * Возвращает id человека, который теперь представляет пользователя.
   */
  async linkUser(
    tx: Tx,
    userId: string,
    personId: string,
  ): Promise<{ personId: string; mergedFrom: string | null }> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.personId === personId) return { personId, mergedFrom: null };
    const owner = await tx.user.findFirst({ where: { personId }, select: { id: true } });
    if (owner) throw new DomainError('ALREADY_EXISTS', { resource: 'person_account' });
    if (!user.personId) {
      await tx.user.update({ where: { id: userId }, data: { personId } });
      return { personId, mergedFrom: null };
    }
    await this.repoint(tx, personId, user.personId);
    await tx.person.update({ where: { id: personId }, data: { mergedIntoId: user.personId } });
    return { personId: user.personId, mergedFrom: personId };
  }

  /**
   * Модули-владельцы ссылок на человека (представители, согласия) переносят их при слиянии записей:
   * people не пишет в чужие таблицы.
   */
  registerMergeHandler(handler: PersonMergeHandler): void {
    this.mergeHandlers.push(handler);
  }

  private async repoint(tx: Tx, fromPersonId: string, toPersonId: string): Promise<void> {
    for (const handler of this.mergeHandlers) await handler(tx, fromPersonId, toPersonId);
  }

  /**
   * Слияние дублей (G-08): исходная запись помечается `mergedIntoId`. Аккаунт переносится, если он есть только
   * у исходной записи; если аккаунты есть у обеих — слияние невозможно без решения администратора.
   */
  async merge(tx: Tx, sourcePersonId: string, targetPersonId: string): Promise<void> {
    const [sourceUser, targetUser] = await Promise.all([
      tx.user.findFirst({ where: { personId: sourcePersonId }, select: { id: true } }),
      tx.user.findFirst({ where: { personId: targetPersonId }, select: { id: true } }),
    ]);
    if (sourceUser && targetUser) {
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['both_have_accounts'] });
    }
    if (sourceUser) {
      await tx.user.update({
        where: { id: sourceUser.id },
        data: { personId: targetPersonId, permissionsVersion: { increment: 1 } },
      });
    }
    await this.repoint(tx, sourcePersonId, targetPersonId);
    await tx.person.update({ where: { id: sourcePersonId }, data: { mergedIntoId: targetPersonId } });
  }
}
