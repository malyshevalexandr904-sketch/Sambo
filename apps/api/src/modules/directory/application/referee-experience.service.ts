// Стаж судьи (правки 07.11.2026, п. 10): год начала судейской практики указывает сам судья в «Настройках».
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';

@Injectable()
export class RefereeExperienceService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async set(user: AuthUser, sinceYear: number | null): Promise<void> {
    await this.db.tx(async (tx) => {
      const me = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { person: { select: { refereeProfile: { select: { id: true, refereeSinceYear: true } } } } },
      });
      const profile = me.person?.refereeProfile;
      if (!profile) throw new DomainError('FORBIDDEN', { reason: 'referee_profile_required' });
      await tx.refereeProfile.update({
        where: { id: profile.id },
        data: { refereeSinceYear: sinceYear, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'referee.experience_updated',
        entityType: 'RefereeProfile',
        entityId: profile.id,
        before: { refereeSinceYear: profile.refereeSinceYear },
        after: { refereeSinceYear: sinceYear },
      });
    });
  }
}
