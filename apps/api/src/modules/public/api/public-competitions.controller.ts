import { Controller, Get, Header, Res, type StreamableFile } from '@nestjs/common';
import {
  type CompetitionMediaDto,
  type DataEnvelope,
  type PublicBracketsDto,
  type PublicLiveDto,
  type Page,
  type PublicCompetition,
  type PublicCompetitionRatingSummary,
  PublicCompetitionsQuery,
  type PublicCompetitionSummary,
  type PublicRatedMatch,
  RatedMatchesQuery,
  Slug,
} from '@sde/contracts';
import type { Response } from 'express';
import { ok } from '../../../common/http/http';
import { RateLimit } from '../../../common/security/rate-limit';
import { ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { Public } from '../../access';
import { RegulationDocumentService, RegulationPdfQuery, regulationPdfResponse } from '../../competitions';
import { CompetitionRatingResultsService } from '../../rating';
import { PublicCompetitionsService } from '../application/public-competitions.service';

/** Кэш публичных ответов (API.md, 5.9): минута свежести, пять минут устаревшего ответа при обновлении. */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** Публичный API только для чтения (раздел 58 ТЗ): без входа, отдельный префикс `/api/public/v1`. */
@Controller('api/public/v1/competitions')
@RateLimit('public')
export class PublicCompetitionsController {
  constructor(
    private readonly competitions: PublicCompetitionsService,
    private readonly rating: CompetitionRatingResultsService,
    private readonly regulation: RegulationDocumentService,
  ) {}

  @Get()
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  list(
    @ValidQuery(PublicCompetitionsQuery) q: PublicCompetitionsQuery,
  ): Promise<Page<PublicCompetitionSummary>> {
    return this.competitions.list(q);
  }

  @Get(':slug')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async get(@ValidParam('slug', Slug) slug: string): Promise<DataEnvelope<PublicCompetition>> {
    return ok(await this.competitions.get(slug));
  }

  /** Турнирные сетки и итоговые протоколы (правки 05.11.2026): с жеребьёвки. */
  @Get(':slug/brackets')
  @Public()
  @Header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
  async brackets(@ValidParam('slug', Slug) slug: string): Promise<DataEnvelope<PublicBracketsDto>> {
    return ok(await this.competitions.brackets(slug));
  }

  @Get(':slug/live')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async live(@ValidParam('slug', Slug) slug: string): Promise<DataEnvelope<PublicLiveDto>> {
    return ok(await this.competitions.live(slug));
  }

  @Get(':slug/media')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async media(@ValidParam('slug', Slug) slug: string): Promise<DataEnvelope<CompetitionMediaDto[]>> {
    return ok(await this.competitions.media(slug));
  }

  /**
   * Фирменное положение турнира «Цифровое Самбо» (правки 05.11.2026, п. 8): PDF по текущим данным турнира.
   * `?download=1` — скачать файлом, без параметра — показать во встроенном просмотрщике страницы турнира.
   */
  @Get(':slug/regulation.pdf')
  @Public()
  async regulationPdf(
    @ValidParam('slug', Slug) slug: string,
    @ValidQuery(RegulationPdfQuery) q: RegulationPdfQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return regulationPdfResponse(res, await this.regulation.forPublic(slug), q, PUBLIC_CACHE);
  }

  /** Изменения рейтинга участников рейтингового турнира (ТЗ 45, 48), если турнир показывает их публично. */
  @Get(':slug/rating-summary')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async ratingSummary(
    @ValidParam('slug', Slug) slug: string,
  ): Promise<DataEnvelope<PublicCompetitionRatingSummary>> {
    return ok(await this.rating.summary(slug));
  }

  /** Посчитанные схватки рейтингового турнира с рейтингом до и после, новые сверху. */
  @Get(':slug/rated-matches')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  ratedMatches(
    @ValidParam('slug', Slug) slug: string,
    @ValidQuery(RatedMatchesQuery) q: RatedMatchesQuery,
  ): Promise<Page<PublicRatedMatch>> {
    return this.rating.matches(slug, q);
  }
}
