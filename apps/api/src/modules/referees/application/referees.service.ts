// Судьи и судейские категории (API.md, 4.3). Реестр судей общий: судья работает на турнирах разных
// организаций, поэтому ведёт его любой, у кого есть `referee.manage` (администратор федерации, платформа).
import { Injectable } from '@nestjs/common';
import {
  fullName,
  type Page,
  type RefereeCreate,
  type RefereePatch,
  type RefereesQuery,
  type RefereeSummary,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { PeopleService } from '../../people';

const INCLUDE = {
  person: { include: { user: { select: { id: true } } } },
  category: true,
} satisfies Prisma.RefereeProfileInclude;

type Row = Prisma.RefereeProfileGetPayload<{ include: typeof INCLUDE }>;

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

function toDto(r: Row): RefereeSummary {
  return {
    id: r.id,
    personId: r.personId,
    name: fullName(r.person),
    userId: r.person.user?.id ?? null,
    regionId: r.person.regionId,
    category: { code: r.category.code, name: { ru: r.category.nameRu, en: r.category.nameEn } },
    categoryAssignedAt: dateOnly(r.categoryAssignedAt),
    status: r.status,
    version: r.version,
  };
}

@Injectable()
export class RefereesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  private async assertManager(user: AuthUser): Promise<void> {
    if (!(await this.policy.holdsAnywhere(user, 'referee.manage')))
      throw new DomainError('FORBIDDEN', { permission: 'referee.manage' });
  }

  async list(user: AuthUser, q: RefereesQuery): Promise<Page<RefereeSummary>> {
    const allowed =
      (await this.policy.holdsAnywhere(user, 'referee.manage')) ||
      (await this.policy.holdsAnywhere(user, 'competition.members.manage'));
    if (!allowed) throw new DomainError('FORBIDDEN', { permission: 'referee.manage' });
    const cursor = decodeCursor(q.cursor);
    const needle = q.q?.toLowerCase().replaceAll('ё', 'е');
    const personIds = needle
      ? (
          await this.db.$queryRaw<{ id: string }[]>`
            SELECT id FROM person WHERE last_name_norm LIKE ${needle + '%'} OR first_name_norm LIKE ${needle + '%'} LIMIT 1000`
        ).map((r) => r.id)
      : undefined;
    const rows = await this.db.refereeProfile.findMany({
      where: {
        status: q.status,
        refereeCategoryCode: q.categoryCode,
        person: { regionId: q.regionId, id: personIds ? { in: personIds } : undefined },
        ...(cursor
          ? {
              OR: [
                { person: { lastName: { gt: cursor.k } } },
                { person: { lastName: cursor.k }, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ person: { lastName: 'asc' } }, { id: 'asc' }],
      take: q.limit + 1,
      include: INCLUDE,
    });
    return toPage(rows, q.limit, (r) => ({ k: r.person.lastName, id: r.id }), toDto);
  }

  private async assertCategory(tx: Tx, code: string): Promise<void> {
    if (!(await tx.refereeCategory.findUnique({ where: { code } })))
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'refereeCategoryCode', code: 'invalid_code' }],
      });
  }

  async create(user: AuthUser, input: RefereeCreate): Promise<RefereeSummary> {
    await this.assertManager(user);
    const id = await this.db.tx(async (tx) => {
      await this.assertCategory(tx, input.refereeCategoryCode);
      let personId: string;
      if (input.userId) {
        const target = await tx.user.findUnique({ where: { id: input.userId }, select: { personId: true } });
        if (!target)
          throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'userId', code: 'not_found' }] });
        if (!target.personId)
          throw new DomainError('VALIDATION_FAILED', {
            fields: [{ path: 'userId', code: 'person_required' }],
          });
        personId = target.personId;
      } else {
        if (!input.person)
          throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'person', code: 'required' }] });
        if (!input.confirmNotDuplicate) {
          const dupes = await this.people.exactMatches(tx, input.person);
          if (dupes.length > 0) throw new DomainError('POSSIBLE_DUPLICATE', { count: dupes.length });
        }
        personId = (await this.people.create(tx, input.person, user.id)).id;
      }
      if (await tx.refereeProfile.findUnique({ where: { personId } }))
        throw new DomainError('ALREADY_EXISTS', { resource: 'referee' });
      const created = await tx.refereeProfile.create({
        data: {
          id: uuidv7(),
          personId,
          refereeCategoryCode: input.refereeCategoryCode,
          categoryAssignedAt: input.categoryAssignedAt ? toDate(input.categoryAssignedAt) : null,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'referee.created',
        entityType: 'RefereeProfile',
        entityId: created.id,
        after: {
          personId,
          refereeCategoryCode: input.refereeCategoryCode,
          categoryAssignedAt: input.categoryAssignedAt ?? null,
        },
      });
      return created.id;
    });
    return toDto(await this.db.refereeProfile.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
  }

  async update(user: AuthUser, id: string, version: number, patch: RefereePatch): Promise<RefereeSummary> {
    await this.assertManager(user);
    await this.db.tx(async (tx) => {
      const current = await tx.refereeProfile.findUnique({ where: { id } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'referee' });
      if (patch.refereeCategoryCode) await this.assertCategory(tx, patch.refereeCategoryCode);
      const data = {
        refereeCategoryCode: patch.refereeCategoryCode,
        categoryAssignedAt:
          patch.categoryAssignedAt === undefined
            ? undefined
            : patch.categoryAssignedAt === null
              ? null
              : toDate(patch.categoryAssignedAt),
        status: patch.status,
      };
      const { count } = await tx.refereeProfile.updateMany({
        where: { id, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(current.version);
      await this.audit.record(tx, {
        action: 'referee.updated',
        entityType: 'RefereeProfile',
        entityId: id,
        before: {
          refereeCategoryCode: current.refereeCategoryCode,
          categoryAssignedAt: dateOnly(current.categoryAssignedAt),
          status: current.status,
        },
        after: {
          refereeCategoryCode: patch.refereeCategoryCode ?? current.refereeCategoryCode,
          categoryAssignedAt:
            patch.categoryAssignedAt === undefined
              ? dateOnly(current.categoryAssignedAt)
              : patch.categoryAssignedAt,
          status: patch.status ?? current.status,
        },
      });
    });
    return toDto(await this.db.refereeProfile.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
  }
}
