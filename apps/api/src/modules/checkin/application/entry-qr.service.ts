// QR участника (API.md, 5.5): токен на спортсмена в турнире, подписанный HMAC; в QR нет ПДн. Выдаётся владельцу
// заявки, самому спортсмену, подтверждённому представителю и персоналу с `checkin.view`.
import { Injectable } from '@nestjs/common';
import type { EntryQrDto } from '@sde/contracts';
import QRCode from 'qrcode';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService } from '../../athletes';
import { RegistrationAccessService } from '../../registrations';
import { issueQrToken, qrExpiry } from '../domain/checkin-rules';
import { CheckInService } from './checkin.service';

@Injectable()
export class EntryQrService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly athletes: AthleteAccessService,
    private readonly checkins: CheckInService,
  ) {}

  private async assertAllowed(user: AuthUser, entryId: string) {
    const ctx = await this.access.entryContext(entryId);
    if (await this.policy.can(user, 'checkin.view', ctx.competitionScope)) return ctx;
    if (await this.access.isOwner(user, ctx.application.organizationId)) return ctx;
    const rel = await this.athletes.relation(user, ctx.entry.athleteId);
    if (rel.relation === 'SELF' || (rel.relation === 'GUARDIAN' && rel.verified)) return ctx;
    await this.access.assertVisible(user, ctx);
    throw new DomainError('FORBIDDEN', { permission: 'checkin.view' });
  }

  async qr(user: AuthUser, entryId: string): Promise<EntryQrDto> {
    const ctx = await this.assertAllowed(user, entryId);
    if (ctx.entry.status !== 'APPROVED')
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['entry_not_approved'] });
    const { competition } = ctx;
    const exp = qrExpiry(competition.endDate);
    const qrToken = issueQrToken(this.checkins.qrKey, {
      competitionId: competition.id,
      athleteId: ctx.entry.athleteId,
      exp,
    });
    const svg = await QRCode.toString(qrToken, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    const entries = await this.db.entry.findMany({
      where: { competitionId: competition.id, athleteId: ctx.entry.athleteId, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
      select: { category: { select: { code: true, nameRu: true, nameEn: true } } },
    });
    return {
      qrToken,
      svg,
      expiresAt: new Date(exp * 1000).toISOString(),
      competition: { id: competition.id, name: competition.name },
      athlete: { publicName: ctx.entry.publicName },
      categories: entries.map((e) => ({
        code: e.category.code,
        name: { ru: e.category.nameRu, en: e.category.nameEn },
      })),
    };
  }
}
