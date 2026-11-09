// Стадии проведения турнира (правки 05.11.2026): оформление публичной страницы (шаблон афиши, трансляция),
// подписка пользователя на начало регистрации и медиа завершённого турнира (фото и видео).
import { Injectable } from '@nestjs/common';
import type {
  CompetitionFollowDto,
  CompetitionMediaCreate,
  CompetitionMediaDto,
  CompetitionPresentationUpdate,
  CompetitionStatus,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { FilesService } from '../../files';
import { CompetitionScopeService } from './competition-scope.service';

/** Медиа загружают после официального завершения турнира. */
const MEDIA_STATUSES: readonly CompetitionStatus[] = ['FINISHED', 'ARCHIVED'];
/** Подписка на начало регистрации — пока регистрация не открылась. */
const FOLLOWABLE: readonly CompetitionStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN'];
const MEDIA_LIMIT = 300;

@Injectable()
export class CompetitionStagesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly scopes: CompetitionScopeService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /** Шаблон афиши и ссылка на трансляцию: право `competition.update`, в любой стадии, кроме отменённой. */
  async updatePresentation(user: AuthUser, id: string, input: CompetitionPresentationUpdate): Promise<void> {
    const basics = await this.scopes.require(id);
    const access = await this.policy.assert(user, 'competition.update', await this.scopes.scopeFor(basics));
    if (basics.status === 'CANCELLED')
      throw new DomainError('COMPETITION_STAGE_MISMATCH', { status: basics.status });
    await this.db.tx(async (tx) => {
      const before = await tx.competition.findUniqueOrThrow({
        where: { id },
        select: { posterTemplate: true, liveStreamUrl: true, daySchedule: true },
      });
      await tx.competition.update({
        where: { id },
        data: {
          ...(input.posterTemplate !== undefined ? { posterTemplate: input.posterTemplate } : {}),
          ...(input.liveStreamUrl !== undefined ? { liveStreamUrl: input.liveStreamUrl } : {}),
          ...(input.daySchedule !== undefined ? { daySchedule: input.daySchedule } : {}),
          version: { increment: 1 },
          updatedById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'competition.presentation_updated',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: basics.organizerOrganizationId,
        before,
        after: input,
        platformIntervention: access.viaPlatform,
      });
    });
  }

  // ---------- Подписка на начало регистрации ----------

  async isFollowed(userId: string, competitionId: string): Promise<boolean> {
    const row = await this.db.follow.findUnique({
      where: { userId_targetType_targetId: { userId, targetType: 'COMPETITION', targetId: competitionId } },
      select: { id: true },
    });
    return !!row;
  }

  /** Подписка любого вошедшего на опубликованный турнир: уведомление в ленту, на почту и push при открытии. */
  async follow(user: AuthUser, id: string, follow: boolean): Promise<CompetitionFollowDto> {
    const basics = await this.scopes.require(id);
    if (follow) {
      if (!FOLLOWABLE.includes(basics.status))
        throw new DomainError('COMPETITION_STAGE_MISMATCH', {
          status: basics.status,
          reason: 'registration_not_upcoming',
        });
      await this.db.follow.upsert({
        where: { userId_targetType_targetId: { userId: user.id, targetType: 'COMPETITION', targetId: id } },
        create: { id: uuidv7(), userId: user.id, targetType: 'COMPETITION', targetId: id },
        update: {},
      });
    } else {
      await this.db.follow.deleteMany({
        where: { userId: user.id, targetType: 'COMPETITION', targetId: id },
      });
    }
    return { followed: follow };
  }

  // ---------- Медиа ----------

  async listMedia(competitionId: string): Promise<CompetitionMediaDto[]> {
    const rows = await this.db.competitionMedia.findMany({
      where: { competitionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MEDIA_LIMIT,
      include: { file: { select: { storageKey: true, status: true } } },
    });
    return rows.flatMap((r): CompetitionMediaDto[] => {
      const url =
        r.kind === 'PHOTO'
          ? r.file?.status === 'AVAILABLE'
            ? this.files.publicUrl(r.file.storageKey)
            : null
          : r.url;
      return url
        ? [{ id: r.id, kind: r.kind, url, caption: r.caption, createdAt: r.createdAt.toISOString() }]
        : [];
    });
  }

  private async assertMediaWriter(user: AuthUser, id: string) {
    const basics = await this.scopes.require(id);
    const access = await this.policy.assert(user, 'competition.update', await this.scopes.scopeFor(basics));
    if (!MEDIA_STATUSES.includes(basics.status))
      throw new DomainError('COMPETITION_STAGE_MISMATCH', {
        status: basics.status,
        reason: 'competition_not_finished',
      });
    return { basics, access };
  }

  async addMedia(user: AuthUser, id: string, input: CompetitionMediaCreate): Promise<CompetitionMediaDto[]> {
    const { basics, access } = await this.assertMediaWriter(user, id);
    await this.db.tx(async (tx) => {
      if ((await tx.competitionMedia.count({ where: { competitionId: id } })) >= MEDIA_LIMIT)
        throw new DomainError('MEDIA_LIMIT_EXCEEDED', { limit: MEDIA_LIMIT });
      if (input.kind === 'PHOTO')
        await this.files.assertAttachable(tx, input.fileId, user.id, 'COMPETITION_MEDIA', 'fileId');
      const mediaId = uuidv7();
      await tx.competitionMedia.create({
        data: {
          id: mediaId,
          competitionId: id,
          kind: input.kind,
          fileId: input.kind === 'PHOTO' ? input.fileId : null,
          url: input.kind === 'VIDEO' ? input.url : null,
          caption: input.caption || null,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'competition.media_added',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: basics.organizerOrganizationId,
        after: { mediaId, kind: input.kind },
        platformIntervention: access.viaPlatform,
      });
    });
    return this.listMedia(id);
  }

  async removeMedia(user: AuthUser, id: string, mediaId: string): Promise<CompetitionMediaDto[]> {
    const basics = await this.scopes.require(id);
    const access = await this.policy.assert(user, 'competition.update', await this.scopes.scopeFor(basics));
    await this.db.tx(async (tx) => {
      const { count } = await tx.competitionMedia.deleteMany({ where: { id: mediaId, competitionId: id } });
      if (count === 0) throw new DomainError('NOT_FOUND', { resource: 'competition_media' });
      await this.audit.record(tx, {
        action: 'competition.media_removed',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: basics.organizerOrganizationId,
        before: { mediaId },
        platformIntervention: access.viaPlatform,
      });
    });
    return this.listMedia(id);
  }
}
