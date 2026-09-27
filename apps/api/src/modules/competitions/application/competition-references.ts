// Проверки ссылок турнира (API.md, 5.1): дисциплина, место проведения, версия правил, логотип и адрес (slug).
// Ошибки — VALIDATION_FAILED с полем, SLUG_TAKEN для занятого адреса.
import { Injectable } from '@nestjs/common';
import type { CompetitionPatch } from '@sde/contracts';
import { type Competition, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { FilesService } from '../../files';
import { OrganizationScopeService, slugify } from '../../organizations';
import { RuleSetsService } from '../../rulesets';
import { competitionSlugBase } from '../domain/competition-slug';

const fieldError = (path: string, code: string): DomainError =>
  new DomainError('VALIDATION_FAILED', { fields: [{ path, code }] });

@Injectable()
export class CompetitionReferences {
  constructor(
    private readonly orgScopes: OrganizationScopeService,
    private readonly rulesets: RuleSetsService,
    private readonly files: FilesService,
  ) {}

  async assertDiscipline(tx: Tx, code: string): Promise<void> {
    if (!(await tx.discipline.findUnique({ where: { code } })))
      throw fieldError('disciplineCode', 'not_found');
  }

  /** Место — организатора или вышестоящей организации (федерации). */
  async assertVenue(tx: Tx, venueId: string, organizerId: string): Promise<void> {
    const venue = await tx.venue.findFirst({ where: { id: venueId, deletedAt: null } });
    const lineage = (await this.orgScopes.scopeOf(organizerId)).ancestorIds;
    if (!venue || !lineage.includes(venue.ownerOrganizationId)) throw fieldError('venueId', 'not_found');
  }

  /** Закрепляется только опубликованная версия правил дисциплины турнира, доступная организатору. */
  async assertRuleSetVersion(
    tx: Tx,
    versionId: string,
    disciplineCode: string,
    organizerId: string,
  ): Promise<void> {
    const v = await this.rulesets.versionInfo(versionId, tx);
    const lineage = (await this.orgScopes.scopeOf(organizerId)).ancestorIds;
    if (!v || (v.ownerOrganizationId !== null && !lineage.includes(v.ownerOrganizationId)))
      throw fieldError('ruleSetVersionId', 'not_found');
    if (v.status !== 'PUBLISHED') throw fieldError('ruleSetVersionId', 'ruleset_not_published');
    if (v.disciplineCode !== disciplineCode)
      throw fieldError('ruleSetVersionId', 'ruleset_discipline_mismatch');
  }

  async assertLogo(tx: Tx, fileId: string, user: AuthUser): Promise<void> {
    await this.files.assertAttachable(tx, fileId, user.id, 'COMPETITION_LOGO', 'logoFileId');
  }

  /** Ссылки изменения: новая дисциплина согласуется с закреплённой версией правил, если её не меняют. */
  async assertPatch(tx: Tx, user: AuthUser, current: Competition, patch: CompetitionPatch): Promise<void> {
    const discipline = patch.disciplineCode ?? current.disciplineCode;
    const organizerId = current.organizerOrganizationId;
    if (patch.disciplineCode !== undefined) await this.assertDiscipline(tx, patch.disciplineCode);
    if (patch.venueId) await this.assertVenue(tx, patch.venueId, organizerId);
    if (patch.ruleSetVersionId)
      await this.assertRuleSetVersion(tx, patch.ruleSetVersionId, discipline, organizerId);
    else if (
      patch.disciplineCode !== undefined &&
      current.ruleSetVersionId &&
      patch.ruleSetVersionId !== null
    ) {
      const v = await this.rulesets.versionInfo(current.ruleSetVersionId, tx);
      if (v?.disciplineCode !== discipline)
        throw fieldError('ruleSetVersionId', 'ruleset_discipline_mismatch');
    }
    if (patch.logoFileId && patch.logoFileId !== current.logoFileId)
      await this.assertLogo(tx, patch.logoFileId, user);
  }

  /** Адрес турнира: запрошенный (если свободен) или из названия и года начала с номером при совпадении. */
  async uniqueSlug(
    tx: Tx,
    name: string,
    startDate: string,
    requested?: string,
    excludeId?: string,
  ): Promise<string> {
    const taken = async (slug: string): Promise<boolean> =>
      (await tx.competition.findFirst({
        where: { slug, id: excludeId ? { not: excludeId } : undefined },
        select: { id: true },
      })) !== null;
    if (requested) {
      if (await taken(requested)) throw new DomainError('SLUG_TAKEN');
      return requested;
    }
    const base = competitionSlugBase(slugify(name), startDate);
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? base : `${base.slice(0, 74)}-${i}`;
      if (!(await taken(candidate))) return candidate;
    }
    return `${base.slice(0, 60)}-${uuidv7().slice(-8)}`;
  }
}
