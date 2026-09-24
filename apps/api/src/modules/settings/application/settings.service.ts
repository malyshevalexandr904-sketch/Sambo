// Системные настройки (API.md, 3.7). Ключи и схемы значений — в contracts (SYSTEM_SETTINGS).
import { Injectable } from '@nestjs/common';
import {
  isSystemSettingKey,
  SYSTEM_SETTING_DEFAULTS,
  SYSTEM_SETTINGS,
  type SystemSettingDto,
  type SystemSettingKey,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { z } from 'zod';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';

type Value<K extends SystemSettingKey> = z.infer<(typeof SYSTEM_SETTINGS)[K]>;

const CACHE_MS = 30_000;

@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SystemSettingKey>(key: K): Promise<Value<K>> {
    const values = await this.load();
    const raw = values.get(key);
    if (raw === undefined) return SYSTEM_SETTING_DEFAULTS[key];
    const parsed = SYSTEM_SETTINGS[key].safeParse(raw);
    return parsed.success ? (parsed.data as Value<K>) : SYSTEM_SETTING_DEFAULTS[key];
  }

  async list(): Promise<SystemSettingDto[]> {
    const rows = await this.db.systemSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return (Object.keys(SYSTEM_SETTINGS) as SystemSettingKey[]).map((key) => {
      const row = byKey.get(key);
      return {
        key,
        value: row ? row.value : SYSTEM_SETTING_DEFAULTS[key],
        isDefault: !row,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        updatedById: row?.updatedById ?? null,
      };
    });
  }

  async put(key: string, value: unknown, userId: string): Promise<SystemSettingDto> {
    if (!isSystemSettingKey(key)) throw new DomainError('NOT_FOUND', { resource: 'setting' });
    const parsed = SYSTEM_SETTINGS[key].safeParse(value);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        fields: parsed.error.issues.map((i) => ({
          path: ['value', ...i.path.map(String)].join('.'),
          code: i.message,
        })),
      });
    }
    const json = z.json().parse(parsed.data) as Prisma.InputJsonValue;
    const row = await this.db.tx(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      const saved = await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: json, updatedById: userId },
        update: { value: json, updatedById: userId },
      });
      await this.audit.record(tx, {
        action: 'setting.updated',
        entityType: 'SystemSetting',
        before: { key, value: before?.value ?? SYSTEM_SETTING_DEFAULTS[key] },
        after: { key, value: saved.value },
      });
      return saved;
    });
    this.cache = null;
    return {
      key,
      value: row.value,
      isDefault: false,
      updatedAt: row.updatedAt.toISOString(),
      updatedById: row.updatedById,
    };
  }

  private async load(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.values;
    const rows = await this.db.systemSetting.findMany();
    this.cache = { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) };
    return this.cache.values;
  }
}
