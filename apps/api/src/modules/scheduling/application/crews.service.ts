// Судейские бригады ковра (Phase 6, §5; D-07): по сессии и ковру — должности (гл. судья ковра, судья, боковой
// судья, технический секретарь, оператор табло, секундометрист). Назначить можно только персонал турнира —
// судей, гл. судью, секретарей (CREW_CANDIDATE_ROLES); один человек — на один ковёр в одной сессии. Право —
// mat_assignment.manage (TOURNAMENT_MANAGER, CHIEF_REFEREE); чтение — competition.view (весь персонал турнира).
import { Injectable } from '@nestjs/common';
import {
  CREW_CANDIDATE_ROLES,
  type CrewCandidateDto,
  type MatAssignmentCopy,
  type MatAssignmentDto,
  type MatAssignmentPut,
  type MatCrewRole,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { WriteLeaseService } from '../../venue-sync';
import { lockCompetitionShared } from './schedule-locks';

const ASSIGNMENT_INCLUDE = {
  user: { select: { id: true, displayName: true } },
} satisfies Prisma.MatAssignmentInclude;
type AssignmentRow = Prisma.MatAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

function toDto(r: AssignmentRow): MatAssignmentDto {
  return { id: r.id, sessionId: r.sessionId, matId: r.matId, role: r.role, user: r.user, version: r.version };
}

@Injectable()
export class CrewsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, competitionId: string): Promise<MatAssignmentDto[]> {
    const scope = await this.competitions.scopeOf(competitionId);
    await this.policy.assert(user, 'competition.view', scope);
    const rows = await this.db.matAssignment.findMany({
      where: { competitionId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ sessionId: 'asc' }, { matId: 'asc' }, { role: 'asc' }],
    });
    return rows.map(toDto);
  }

  /** Персонал турнира, которого можно назначить (D-07): судьи, гл. судья, секретари — с принятым приглашением. */
  async candidates(user: AuthUser, competitionId: string): Promise<CrewCandidateDto[]> {
    const scope = await this.competitions.scopeOf(competitionId);
    await this.policy.assert(user, 'competition.view', scope);
    const rows = await this.db.competitionMembership.findMany({
      where: {
        competitionId,
        status: 'ACTIVE',
        userId: { not: null },
        role: { code: { in: [...CREW_CANDIDATE_ROLES] } },
      },
      include: { role: { select: { code: true } }, user: { select: { id: true, displayName: true } } },
    });
    const result: CrewCandidateDto[] = [];
    for (const r of rows) {
      if (!r.user) continue;
      result.push({
        id: r.user.id,
        displayName: r.user.displayName,
        roleCode: r.role.code as CrewCandidateDto['roleCode'],
      });
    }
    return result;
  }

  private async assertCandidates(tx: Tx, competitionId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const rows = await tx.competitionMembership.findMany({
      where: {
        competitionId,
        status: 'ACTIVE',
        userId: { in: [...userIds] },
        role: { code: { in: [...CREW_CANDIDATE_ROLES] } },
      },
      select: { userId: true },
    });
    const valid = new Set(rows.map((r) => r.userId));
    for (const id of userIds)
      if (!valid.has(id))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'assignments', code: 'not_tournament_staff' }],
        });
  }

  /**
   * Сериализует параллельные записи бригады одной сессии (план §5: один человек — на одном ковре этой сессии).
   * Без неё `assertNoDoubleBooking` — обычный SELECT при ReadCommitted: два одновременных PUT на разные ковры
   * той же сессии не видят чужую ещё не зафиксированную запись, оба проходят проверку и оба коммитятся — человек
   * оказывается на двух коврах сразу. Блокировка — по сессии-получателю записи (req.sessionId в put,
   * req.toSessionId в copy), как и остальные команды модуля сериализуются advisory-блокировкой по ключу
   * (matches.service.ts, entry-commands.ts).
   */
  private async lockSessionCrews(tx: Tx, sessionId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mat_assignment:${sessionId}`}, 0))`;
  }

  /** Один человек не может стоять на двух коврах одной сессии одновременно; `except` — ковры, которые сейчас
   *  перезаписываются этой же командой (в них эти же люди легитимно останутся). */
  private async assertNoDoubleBooking(
    tx: Tx,
    sessionId: string,
    userIds: readonly string[],
    except: readonly string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const conflict = await tx.matAssignment.findFirst({
      where: { sessionId, matId: { notIn: [...except] }, userId: { in: [...userIds] } },
    });
    if (conflict)
      throw new DomainError('MAT_ASSIGNMENT_CONFLICT', { userId: conflict.userId, matId: conflict.matId });
  }

  /** Полная замена бригады ковра в сессии (без версии — последняя запись побеждает, как и вся расстановка ролей). */
  async put(user: AuthUser, competitionId: string, req: MatAssignmentPut): Promise<MatAssignmentDto[]> {
    const scope = await this.competitions.scopeOf(competitionId);
    const { viaPlatform } = await this.policy.assert(user, 'mat_assignment.manage', scope);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await lockCompetitionShared(tx, competitionId);
      await this.lockSessionCrews(tx, req.sessionId);
      const [session, mat] = await Promise.all([
        tx.session.findFirst({ where: { id: req.sessionId, competitionId } }),
        tx.mat.findFirst({ where: { id: req.matId, competitionId } }),
      ]);
      if (!session) throw new DomainError('NOT_FOUND', { resource: 'session' });
      if (!mat) throw new DomainError('NOT_FOUND', { resource: 'mat' });

      const toCreate: { role: MatCrewRole; userId: string }[] = [];
      for (const a of req.assignments)
        if (a.userId !== null) toCreate.push({ role: a.role, userId: a.userId });
      const userIds = [...new Set(toCreate.map((a) => a.userId))];
      await this.assertCandidates(tx, competitionId, userIds);
      await this.assertNoDoubleBooking(tx, req.sessionId, userIds, [req.matId]);

      const before = await tx.matAssignment.findMany({
        where: { sessionId: req.sessionId, matId: req.matId },
      });
      await tx.matAssignment.deleteMany({ where: { sessionId: req.sessionId, matId: req.matId } });
      if (toCreate.length > 0)
        await tx.matAssignment.createMany({
          data: toCreate.map((a) => ({
            id: uuidv7(),
            competitionId,
            sessionId: req.sessionId,
            matId: req.matId,
            role: a.role,
            userId: a.userId,
          })),
        });

      await this.audit.record(tx, {
        action: 'mat_assignment.updated',
        entityType: 'MatAssignment',
        entityId: mat.id,
        competitionId,
        before: {
          sessionId: req.sessionId,
          matId: req.matId,
          roles: before.map((b) => ({ role: b.role, userId: b.userId })),
        },
        after: { sessionId: req.sessionId, matId: req.matId, roles: toCreate },
        platformIntervention: viaPlatform,
      });
    });
    return this.forMat(competitionId, req.sessionId, req.matId);
  }

  private async forMat(competitionId: string, sessionId: string, matId: string): Promise<MatAssignmentDto[]> {
    const rows = await this.db.matAssignment.findMany({
      where: { competitionId, sessionId, matId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: { role: 'asc' },
    });
    return rows.map(toDto);
  }

  /**
   * «Копировать бригады с предыдущей сессии» (план §5): без `matId` — все ковры сессии-источника, целиком
   * заменяя те же ковры в сессии-получателе; с `matId` — один ковёр.
   */
  async copy(user: AuthUser, competitionId: string, req: MatAssignmentCopy): Promise<MatAssignmentDto[]> {
    const scope = await this.competitions.scopeOf(competitionId);
    const { viaPlatform } = await this.policy.assert(user, 'mat_assignment.manage', scope);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await lockCompetitionShared(tx, competitionId);
      await this.lockSessionCrews(tx, req.toSessionId);
      const [fromSession, toSession] = await Promise.all([
        tx.session.findFirst({ where: { id: req.fromSessionId, competitionId } }),
        tx.session.findFirst({ where: { id: req.toSessionId, competitionId } }),
      ]);
      if (!fromSession) throw new DomainError('NOT_FOUND', { resource: 'session' });
      if (!toSession) throw new DomainError('NOT_FOUND', { resource: 'session' });
      if (req.matId) {
        const mat = await tx.mat.findFirst({ where: { id: req.matId, competitionId } });
        if (!mat) throw new DomainError('NOT_FOUND', { resource: 'mat' });
      }

      const source = await tx.matAssignment.findMany({
        where: { sessionId: req.fromSessionId, matId: req.matId },
      });
      const matIds = [...new Set(source.map((r) => r.matId))];
      const userIds = [...new Set(source.map((r) => r.userId))];
      await this.assertNoDoubleBooking(tx, req.toSessionId, userIds, matIds);

      const before = await tx.matAssignment.findMany({
        where: { sessionId: req.toSessionId, matId: req.matId },
      });
      await tx.matAssignment.deleteMany({ where: { sessionId: req.toSessionId, matId: req.matId } });
      if (source.length > 0)
        await tx.matAssignment.createMany({
          data: source.map((r) => ({
            id: uuidv7(),
            competitionId,
            sessionId: req.toSessionId,
            matId: r.matId,
            role: r.role,
            userId: r.userId,
          })),
        });

      await this.audit.record(tx, {
        action: 'mat_assignment.copied',
        entityType: 'MatAssignment',
        entityId: req.toSessionId,
        competitionId,
        before: {
          sessionId: req.toSessionId,
          matId: req.matId ?? null,
          roles: before.map((b) => ({ matId: b.matId, role: b.role, userId: b.userId })),
        },
        after: {
          fromSessionId: req.fromSessionId,
          sessionId: req.toSessionId,
          matId: req.matId ?? null,
          roles: source.map((b) => ({ matId: b.matId, role: b.role, userId: b.userId })),
        },
        platformIntervention: viaPlatform,
      });
    });
    const rows = await this.db.matAssignment.findMany({
      where: { competitionId, sessionId: req.toSessionId, matId: req.matId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ matId: 'asc' }, { role: 'asc' }],
    });
    return rows.map(toDto);
  }
}
