// Последствия одобрения заявки (Phase 9a) — в той же транзакции, что и смена статуса: запись «человек» заявителя,
// профиль роли, членство в организации и связь с тренером, организация руководителя. Создают их модули-владельцы
// (people, coaches, athletes, referees, organizations); здесь — только порядок и условия.
import { Injectable } from '@nestjs/common';
import type { Prisma, Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { AthleteRegistryService } from '../../athletes';
import { CoachesService } from '../../coaches';
import { OrganizationRegistryService } from '../../organizations';
import { PeopleService } from '../../people';
import { RefereesService } from '../../referees';
import { normalizeOrganizationName } from '../domain/onboarding-rules';
import { type OnboardingState, stateOf } from './onboarding-state';

type Row = Prisma.OnboardingRequestGetPayload<object>;

export interface ApprovalResult {
  resultOrganizationId: string | null;
}

@Injectable()
export class OnboardingApprovalService {
  constructor(
    private readonly people: PeopleService,
    private readonly organizations: OrganizationRegistryService,
    private readonly coaches: CoachesService,
    private readonly athletes: AthleteRegistryService,
    private readonly referees: RefereesService,
  ) {}

  /**
   * Организация уже зарегистрирована (тот же ИНН или то же название после нормализации) или её регистрирует другая
   * незавершённая заявка — второй раз не регистрируется.
   */
  async assertOrganizationNotRegistered(tx: Tx, requestId: string, s: OnboardingState): Promise<void> {
    const o = s.organization;
    if (!o?.name) return;
    const norm = normalizeOrganizationName(o.name);
    const existing = await this.organizations.candidates(tx, {
      nameNorm: o.name.toLowerCase().replaceAll('ё', 'е').trim(),
      inn: o.inn,
    });
    const clash = existing.find(
      (c) => (o.inn && c.inn === o.inn) || normalizeOrganizationName(c.name) === norm,
    );
    if (clash) throw new DomainError('ORGANIZATION_ALREADY_REGISTERED', { organizationId: clash.id });
    const pending = await tx.onboardingRequest.findMany({
      where: {
        id: { not: requestId },
        role: 'ORGANIZATION_HEAD',
        status: { in: ['PENDING_REVIEW', 'CHANGES_REQUESTED'] },
      },
      select: { orgInn: true, orgName: true },
      take: 500,
    });
    if (
      pending.some(
        (p) => (o.inn && p.orgInn === o.inn) || normalizeOrganizationName(p.orgName ?? '') === norm,
      )
    )
      throw new DomainError('ORGANIZATION_ALREADY_REGISTERED', { pending: true });
  }

  /** Запись «человек» заявителя: новая или обновлённая данными заявки (первичная регистрация). */
  private async personOfApplicant(tx: Tx, r: Row, s: OnboardingState): Promise<string> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: r.userId }, select: { personId: true } });
    if (r.kind === 'JOIN_ORGANIZATION') {
      if (!user.personId)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['person_required'] });
      return user.personId;
    }
    if (!s.lastName || !s.firstName || !s.birthDate || !s.gender)
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['person_incomplete'] });
    const person = {
      lastName: s.lastName,
      firstName: s.firstName,
      middleName: s.middleName ?? undefined,
      birthDate: s.birthDate,
      gender: s.gender,
    };
    if (user.personId) {
      await this.people.update(tx, user.personId, { ...person, middleName: s.middleName }, '');
      return user.personId;
    }
    const created = await this.people.create(tx, person, r.userId, '');
    await tx.user.update({ where: { id: r.userId }, data: { personId: created.id } });
    return created.id;
  }

  /** Организация и тренер заявки по-прежнему доступны (организация активна, тренер в ней работает). */
  private async assertStillAvailable(tx: Tx, s: OnboardingState): Promise<void> {
    if (s.organizationId && !(await this.organizations.isSelectable(tx, s.organizationId)))
      throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: s.organizationId });
    if (
      s.coachId &&
      s.organizationId &&
      !(await this.coaches.isSelectableIn(tx, s.coachId, s.organizationId))
    )
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['coach_not_available'] });
  }

  async apply(tx: Tx, r: Row, actorId: string): Promise<ApprovalResult> {
    const s = stateOf(r);
    await this.assertStillAvailable(tx, s);
    const personId = await this.personOfApplicant(tx, r, s);
    let resultOrganizationId: string | null = null;
    switch (r.role) {
      case 'ORGANIZATION_HEAD': {
        const o = s.organization;
        if (!o?.name || !o.type || !o.countryCode)
          throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['organization_incomplete'] });
        await this.assertOrganizationNotRegistered(tx, r.id, s);
        resultOrganizationId = await this.organizations.createApproved(
          tx,
          {
            type: o.type,
            name: o.name,
            shortName: o.shortName ?? o.name.slice(0, 60),
            countryCode: o.countryCode,
            regionId: o.regionId,
            city: o.city,
            contactEmail: s.contactEmail,
            contactPhone: s.phone,
            legal:
              o.legalForm === 'RU_LEGAL_ENTITY' && o.inn && o.legalName && o.legalAddress
                ? { legalName: o.legalName, inn: o.inn, ogrn: o.ogrn, legalAddress: o.legalAddress }
                : null,
          },
          r.userId,
          r.id,
        );
        break;
      }
      case 'COACH': {
        const coachId = await this.coaches.ensureProfileForPerson(tx, personId, actorId);
        if (s.organizationId) {
          await this.coaches.joinOrganization(tx, coachId, s.organizationId, actorId);
          await this.organizations.addMember(tx, s.organizationId, r.userId, 'COACH');
        }
        break;
      }
      case 'ATHLETE': {
        const athleteId = await this.athletes.ensureProfile(tx, personId, actorId);
        if (s.organizationId)
          await this.athletes.joinOrganization(tx, athleteId, s.organizationId, s.coachId, actorId);
        break;
      }
      case 'REFEREE': {
        if (!s.refereeCategoryCode)
          throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
            failed: ['referee_category_required'],
          });
        await this.referees.registerApproved(tx, personId, s.refereeCategoryCode, actorId);
        break;
      }
    }
    await tx.user.update({ where: { id: r.userId }, data: { permissionsVersion: { increment: 1 } } });
    return { resultOrganizationId };
  }
}
