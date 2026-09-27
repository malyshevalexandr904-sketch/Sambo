// Положение турнира (раздел 12 ТЗ; API.md, 5.1): публичный PDF и текст требований. Сроки, место и категории —
// поля турнира и категории турнира; обязательные документы и согласия — требования (модуль категорий).
import { Injectable } from '@nestjs/common';
import type { CompetitionStatus, RegulationUpdate } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { FilesService } from '../../files';

/** Исход взвешивания (D-06) меняется до начала мандатной комиссии и взвешивания. */
const BEFORE_WEIGH_IN: readonly CompetitionStatus[] = ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

@Injectable()
export class RegulationService {
  constructor(
    private readonly db: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /** Положение меняется до завершения турнира; новая редакция PDF — новый файл, прежний остаётся в хранилище. */
  async update(
    user: AuthUser,
    competitionId: string,
    version: number,
    input: RegulationUpdate,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      const current = await tx.competition.findFirst({ where: { id: competitionId, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'competition' });
      if (current.version !== version) throw versionConflict(current.version);
      if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(current.status))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
      if (input.regulationFileId && input.regulationFileId !== current.regulationFileId)
        await this.files.assertAttachable(
          tx,
          input.regulationFileId,
          user.id,
          'REGULATION',
          'regulationFileId',
        );
      const outcome = input.weighInFailureOutcome;
      if (outcome && outcome !== current.weighInFailureOutcome && !BEFORE_WEIGH_IN.includes(current.status))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['weigh_in_started'] });
      const { count } = await tx.competition.updateMany({
        where: { id: competitionId, version },
        data: {
          regulationFileId: input.regulationFileId,
          requirementsMd: input.requirementsMd.trim() === '' ? null : input.requirementsMd,
          weighInFailureOutcome: outcome,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict(current.version + 1);
      await this.audit.record(tx, {
        action: 'competition.regulation_updated',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        organizationId: current.organizerOrganizationId,
        before: {
          regulationFileId: current.regulationFileId,
          requirementsLength: current.requirementsMd?.length ?? 0,
          weighInFailureOutcome: current.weighInFailureOutcome,
        },
        after: {
          regulationFileId:
            input.regulationFileId === undefined ? current.regulationFileId : input.regulationFileId,
          requirementsLength: input.requirementsMd.length,
          weighInFailureOutcome: outcome ?? current.weighInFailureOutcome,
        },
      });
    });
  }
}
