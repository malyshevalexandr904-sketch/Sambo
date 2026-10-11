import { Controller, Get } from '@nestjs/common';
import type { DataEnvelope, PublicMatStateDto } from '@sde/contracts';
import { DomainError } from '../../../common/errors/domain-error';
import { ok } from '../../../common/http/http';
import { RateLimit } from '../../../common/security/rate-limit';
import { UuidParam } from '../../../common/validation/zod.pipe';
import { Public } from '../../access';
import { ScoreboardService } from '../../refereeing';

/**
 * Табло ковра (Phase 8a): снимок состояния ковра опубликованного турнира — первая загрузка табло и запасной опрос,
 * пока нет WebSocket. Живые данные — без кэша (ответы API по умолчанию `no-store`).
 */
@Controller('api/public/v1/mats')
@RateLimit('public')
export class PublicScoreboardController {
  constructor(private readonly scoreboard: ScoreboardService) {}

  @Get(':id/scoreboard')
  @Public()
  async get(@UuidParam('id') id: string): Promise<DataEnvelope<PublicMatStateDto>> {
    const state = await this.scoreboard.matStateById(id);
    if (!state) throw new DomainError('NOT_FOUND', { resource: 'mat' });
    return ok(state);
  }
}
