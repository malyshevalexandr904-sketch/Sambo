// Дивизионы спортсменов по возрасту (docs/RATED_ONLY.md, 4): список и границы задаёт администратор платформы, дивизион
// спортсмена вычисляется по дате рождения. Границы дивизионов не пересекаются: спортсмен — не больше чем в одном.
import { Injectable } from '@nestjs/common';
import {
  type AthleteDivision,
  DIVISION_AGE_POLICIES,
  type DivisionAgePolicy,
  divisionAge,
  type DivisionCreate,
  type DivisionDto,
  divisionFor,
  type DivisionList,
  type DivisionPatch,
  divisionsOverlap,
} from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';

/** Правило счёта возраста хранится в system_setting (не в общем каталоге настроек: меняется на экране дивизионов). */
const POLICY_KEY = 'divisions.agePolicy';
const DEFAULT_POLICY: DivisionAgePolicy = 'BY_BIRTH_YEAR';

type Row = {
  id: string;
  name: string;
  minAge: number | null;
  maxAge: number | null;
  description: string | null;
  version: number;
};

const toDto = (r: Row): DivisionDto => ({
  id: r.id,
  name: r.name,
  minAge: r.minAge,
  maxAge: r.maxAge,
  description: r.description,
  version: r.version,
});

/** По возрастанию нижней границы; без нижней границы — первым. */
const byAge = (a: Row, b: Row): number => (a.minAge ?? -1) - (b.minAge ?? -1) || a.name.localeCompare(b.name);

/** Сегодня по Москве: дивизион меняется в полночь по времени платформы, а не по UTC. */
export function todayMoscow(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
}

@Injectable()
export class DivisionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DivisionList> {
    const [rows, agePolicy] = await Promise.all([this.rows(), this.policy()]);
    return { agePolicy, divisions: rows.map(toDto) };
  }

  /** Дивизион спортсмена по дате рождения (`YYYY-MM-DD`); вне всех дивизионов или без дивизионов — null. */
  async forBirthDate(birthDate: string, today = todayMoscow()): Promise<AthleteDivision | null> {
    const [rows, agePolicy] = await Promise.all([this.rows(), this.policy()]);
    const age = divisionAge(birthDate, today, agePolicy);
    const d = divisionFor(rows, age);
    return d ? { id: d.id, name: d.name, minAge: d.minAge, maxAge: d.maxAge, age, agePolicy } : null;
  }

  async create(input: DivisionCreate): Promise<DivisionDto> {
    const row = await this.db.tx(async (tx) => {
      await this.lock(tx);
      await this.assertNoOverlap(tx, input, null);
      const created = await tx.division.create({
        data: {
          id: uuidv7(),
          name: input.name,
          minAge: input.minAge,
          maxAge: input.maxAge,
          description: input.description ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'division.created',
        entityType: 'Division',
        entityId: created.id,
        after: { name: created.name, minAge: created.minAge, maxAge: created.maxAge },
      });
      return created;
    });
    return toDto(row);
  }

  async update(id: string, version: number, patch: DivisionPatch): Promise<DivisionDto> {
    const row = await this.db.tx(async (tx) => {
      await this.lock(tx);
      const current = await tx.division.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'division' });
      if (current.version !== version) throw versionConflict(current.version);
      const next = {
        name: patch.name ?? current.name,
        minAge: patch.minAge !== undefined ? patch.minAge : current.minAge,
        maxAge: patch.maxAge !== undefined ? patch.maxAge : current.maxAge,
        description: patch.description !== undefined ? patch.description : current.description,
      };
      if (next.minAge !== null && next.maxAge !== null && next.minAge > next.maxAge)
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'maxAge', code: 'age_range_invalid' }],
        });
      await this.assertNoOverlap(tx, next, id);
      const updated = await tx.division.update({
        where: { id },
        data: { ...next, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'division.updated',
        entityType: 'Division',
        entityId: id,
        before: { name: current.name, minAge: current.minAge, maxAge: current.maxAge },
        after: { name: updated.name, minAge: updated.minAge, maxAge: updated.maxAge },
      });
      return updated;
    });
    return toDto(row);
  }

  /** Удаление мягкое: спортсмены дивизиона остаются без дивизиона, пока не заведут подходящий. */
  async remove(id: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const current = await tx.division.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'division' });
      await tx.division.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'division.deleted',
        entityType: 'Division',
        entityId: id,
        before: { name: current.name, minAge: current.minAge, maxAge: current.maxAge },
      });
    });
  }

  async setPolicy(userId: string, agePolicy: DivisionAgePolicy): Promise<DivisionList> {
    await this.db.tx(async (tx) => {
      const before = await this.policy(tx);
      await tx.systemSetting.upsert({
        where: { key: POLICY_KEY },
        create: { key: POLICY_KEY, value: agePolicy, updatedById: userId },
        update: { value: agePolicy, updatedById: userId },
      });
      await this.audit.record(tx, {
        action: 'division.policy_changed',
        entityType: 'SystemSetting',
        before: { agePolicy: before },
        after: { agePolicy },
      });
    });
    return this.list();
  }

  private async rows(): Promise<Row[]> {
    const rows = await this.db.division.findMany({ where: { deletedAt: null } });
    return rows.sort(byAge);
  }

  private async policy(tx?: Tx): Promise<DivisionAgePolicy> {
    const row = await (tx ?? this.db).systemSetting.findUnique({ where: { key: POLICY_KEY } });
    const value = row?.value;
    return typeof value === 'string' && (DIVISION_AGE_POLICIES as readonly string[]).includes(value)
      ? (value as DivisionAgePolicy)
      : DEFAULT_POLICY;
  }

  /** Изменения дивизионов — по одному: проверка пересечений видит согласованный набор. */
  private async lock(tx: Tx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('division'))`;
  }

  private async assertNoOverlap(
    tx: Tx,
    range: { minAge: number | null; maxAge: number | null },
    selfId: string | null,
  ): Promise<void> {
    const others = await tx.division.findMany({
      where: { deletedAt: null, ...(selfId ? { id: { not: selfId } } : {}) },
    });
    const clash = others.find((o) => divisionsOverlap(o, range));
    if (clash) throw new DomainError('DIVISION_OVERLAP', { divisionId: clash.id, name: clash.name });
  }
}
