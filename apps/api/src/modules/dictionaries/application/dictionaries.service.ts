// Справочники (API.md, 3.7): кэш в Redis, сброс при изменении; запись — только `dictionary.manage`.
import { Injectable, Logger } from '@nestjs/common';
import {
  type CountryDto,
  type DictionaryName,
  DictionaryInputs,
  type DisciplineDto,
  type DocumentTypeDto,
  type RankedDictionaryDto,
  type RegionDto,
} from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { sha256Hex } from '@sde/server-kit';
import type { z } from 'zod';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import { AuditService } from '../../audit';

const CACHE_TTL_SECONDS = 3600;

export interface CachedDictionary<T> {
  items: T[];
  etag: string;
}

@Injectable()
export class DictionariesService {
  private readonly logger = new Logger(DictionariesService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private async cached<T>(key: string, load: () => Promise<T[]>): Promise<CachedDictionary<T>> {
    const redisKey = `dict:${key}`;
    try {
      const hit = await this.redis.get(redisKey);
      if (hit) return JSON.parse(hit) as CachedDictionary<T>;
    } catch (e) {
      this.logger.warn({ err: e }, 'Dictionary cache unavailable');
    }
    const items = await load();
    const value: CachedDictionary<T> = { items, etag: `"${sha256Hex(JSON.stringify(items)).slice(0, 16)}"` };
    this.redis.set(redisKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
    return value;
  }

  private async invalidate(name: DictionaryName): Promise<void> {
    const keys =
      name === 'regions' ? await this.redis.keys('dict:regions:*').catch(() => []) : [`dict:${name}`];
    if (keys.length > 0) await this.redis.del(...keys).catch(() => undefined);
  }

  countries(): Promise<CachedDictionary<CountryDto>> {
    return this.cached('countries', async () =>
      (await this.db.country.findMany({ orderBy: { nameRu: 'asc' } })).map((c) => ({
        code: c.code,
        name: { ru: c.nameRu, en: c.nameEn },
      })),
    );
  }

  regions(countryCode: string): Promise<CachedDictionary<RegionDto>> {
    return this.cached(`regions:${countryCode}`, async () =>
      (await this.db.region.findMany({ where: { countryCode }, orderBy: { nameRu: 'asc' } })).map((r) => ({
        id: r.id,
        countryCode: r.countryCode,
        code: r.code,
        name: { ru: r.nameRu, en: r.nameEn },
      })),
    );
  }

  sportRanks(): Promise<CachedDictionary<RankedDictionaryDto>> {
    return this.cached('sport-ranks', async () =>
      (await this.db.sportRank.findMany({ orderBy: { rankOrder: 'asc' } })).map((r) => ({
        code: r.code,
        name: { ru: r.nameRu, en: r.nameEn },
        rankOrder: r.rankOrder,
      })),
    );
  }

  refereeCategories(): Promise<CachedDictionary<RankedDictionaryDto>> {
    return this.cached('referee-categories', async () =>
      (await this.db.refereeCategory.findMany({ orderBy: { rankOrder: 'asc' } })).map((r) => ({
        code: r.code,
        name: { ru: r.nameRu, en: r.nameEn },
        rankOrder: r.rankOrder,
      })),
    );
  }

  disciplines(): Promise<CachedDictionary<DisciplineDto>> {
    return this.cached('disciplines', async () =>
      (await this.db.discipline.findMany({ orderBy: { code: 'asc' } })).map((d) => ({
        code: d.code,
        name: { ru: d.nameRu, en: d.nameEn },
      })),
    );
  }

  documentTypes(): Promise<CachedDictionary<DocumentTypeDto>> {
    return this.cached('document-types', async () =>
      (await this.db.documentType.findMany({ orderBy: { code: 'asc' } })).map((d) => ({
        code: d.code,
        name: { ru: d.nameRu, en: d.nameEn },
        sensitivity: d.sensitivity,
        allowedMime: d.allowedMime.split(','),
        maxSizeBytes: d.maxSizeBytes,
        retentionDays: d.retentionDays,
      })),
    );
  }

  /** Создание или изменение записи справочника с аудитом (API.md, 3.7: PUT /admin/dictionaries/{name}/{code}). */
  async upsert(name: DictionaryName, code: string, body: unknown): Promise<void> {
    const parsed = DictionaryInputs[name].safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        fields: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.message })),
      });
    }
    await this.db.tx(async (tx) => {
      const before = await this.write(tx, name, code, parsed.data);
      await this.audit.record(tx, {
        action: 'dictionary.upserted',
        entityType: `Dictionary:${name}`,
        before: before as Record<string, unknown> | null,
        after: { code, ...(parsed.data as Record<string, unknown>) },
      });
    });
    await this.invalidate(name);
  }

  /** Запись одной строки справочника; возвращает прежнее состояние для аудита. */
  private async write(tx: Tx, name: DictionaryName, code: string, data: unknown): Promise<unknown> {
    switch (name) {
      case 'countries': {
        const input = data as z.infer<(typeof DictionaryInputs)['countries']>;
        if (!/^[A-Z]{2}$/.test(code))
          throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'code', code: 'invalid_country' }] });
        const before = await tx.country.findUnique({ where: { code } });
        await tx.country.upsert({ where: { code }, create: { code, ...input }, update: input });
        return before;
      }
      case 'regions': {
        const input = data as z.infer<(typeof DictionaryInputs)['regions']>;
        if (!(await tx.country.findUnique({ where: { code: input.countryCode } }))) {
          throw new DomainError('VALIDATION_FAILED', {
            fields: [{ path: 'countryCode', code: 'invalid_country' }],
          });
        }
        const before = await tx.region.findUnique({ where: { code } });
        await tx.region.upsert({ where: { code }, create: { id: uuidv7(), code, ...input }, update: input });
        return before;
      }
      case 'sport-ranks': {
        const input = data as z.infer<(typeof DictionaryInputs)['sport-ranks']>;
        const before = await tx.sportRank.findUnique({ where: { code } });
        await tx.sportRank.upsert({ where: { code }, create: { code, ...input }, update: input });
        return before;
      }
      case 'referee-categories': {
        const input = data as z.infer<(typeof DictionaryInputs)['referee-categories']>;
        const before = await tx.refereeCategory.findUnique({ where: { code } });
        await tx.refereeCategory.upsert({ where: { code }, create: { code, ...input }, update: input });
        return before;
      }
      case 'disciplines': {
        const input = data as z.infer<(typeof DictionaryInputs)['disciplines']>;
        const before = await tx.discipline.findUnique({ where: { code } });
        await tx.discipline.upsert({ where: { code }, create: { code, ...input }, update: input });
        return before;
      }
      case 'document-types': {
        const input = data as z.infer<(typeof DictionaryInputs)['document-types']>;
        const row = { ...input, allowedMime: input.allowedMime.join(',') };
        const before = await tx.documentType.findUnique({ where: { code } });
        await tx.documentType.upsert({ where: { code }, create: { code, ...row }, update: row });
        return before;
      }
    }
  }
}
