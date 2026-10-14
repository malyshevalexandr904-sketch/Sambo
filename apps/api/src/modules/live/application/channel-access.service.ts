// Права на живые каналы (Phase 8a; API.md, 7.2; SECURITY.md, 3.4): публичные — для опубликованного турнира без
// входа; служебные — `competition.view` в турнире (как экраны «Судейство», планшет ковра, страница схватки);
// `user` — только свои уведомления. Подписка не даёт ничего, чего пользователь не прочитал бы по REST.
import { Injectable } from '@nestjs/common';
import {
  type LiveErrorCode,
  type LiveMessage,
  type LiveMessageType,
  type ParsedLiveChannel,
} from '@sde/contracts';
import { liveUserRoom } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { CompetitionScopeService } from '../../competitions';
import { isPublicCompetition, ScoreboardService } from '../../refereeing';
import { LivePublisherService } from './live-publisher.service';

const PUBLIC_SELECT = { status: true, deletedAt: true } as const;

export class LiveDenied extends Error {
  constructor(readonly code: LiveErrorCode) {
    super(code);
  }
}

export interface Subscriber {
  user: AuthUser | null;
  /** Почему пользователь не определён (истёкший или неверный токен): ответ на подписку на служебный канал. */
  authError: LiveErrorCode | null;
}

export interface ChannelGrant {
  /** Комната рассылки (у `user` — `user:{id}`). */
  room: string;
  /** Канал состояния: подписчик получает снимок последнего состояния. */
  state: { type: LiveMessageType; compute: () => Promise<unknown> } | null;
  /** Служебный канал: при истечении входа подписка снимается. */
  private: boolean;
}

/** Сколько узел помнит, опубликован ли турнир (тысячи зрителей подключаются к табло одновременно). */
const PUBLIC_CACHE_MS = 5_000;
const PUBLIC_CACHE_MAX = 2_000;

@Injectable()
export class ChannelAccessService {
  /** Один расчёт снимка на канал на узле, сколько бы зрителей ни подключилось одновременно. */
  private readonly inflight = new Map<string, Promise<LiveMessage | null>>();
  private readonly publicCache = new Map<string, { at: number; value: Promise<boolean> }>();

  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly scoreboard: ScoreboardService,
    private readonly publisher: LivePublisherService,
  ) {}

  async authorize(who: Subscriber, channel: ParsedLiveChannel, name: string): Promise<ChannelGrant> {
    switch (channel.kind) {
      case 'user':
        return { room: liveUserRoom(this.requireUser(who).id), state: null, private: true };
      case 'ops:competition':
      case 'ops:mat':
      case 'ops:match':
        await this.assertStaff(who, await this.competitionOf(who, channel));
        return { room: name, state: null, private: true };
      case 'public:competition':
        await this.assertPublic(`slug:${channel.slug}`, () => this.bySlug(channel.slug));
        return { room: name, state: null, private: false };
      case 'public:competitions':
        // Темы изменений всех опубликованных турниров (slug, без идентификаторов): сброс кэша публичных ответов.
        return { room: name, state: null, private: false };
      case 'public:mat': {
        const { slug, matNumber } = channel;
        // Снимок мог сохраниться, пока турнир был опубликован: публичность проверяется при каждой подписке.
        await this.assertPublic(`slug:${slug}`, () => this.bySlug(slug));
        return {
          room: name,
          state: { type: 'mat.state', compute: () => this.scoreboard.matStateBySlug(slug, matNumber) },
          private: false,
        };
      }
      case 'public:match': {
        const { publicId } = channel;
        await this.assertPublic(`match:${publicId}`, async () => {
          const m = await this.db.match.findUnique({
            where: { publicId },
            select: { competition: { select: PUBLIC_SELECT } },
          });
          return m?.competition ?? null;
        });
        return {
          room: name,
          state: { type: 'match.state', compute: () => this.scoreboard.matchState(publicId) },
          private: false,
        };
      }
    }
  }

  private bySlug(slug: string) {
    return this.db.competition.findUnique({ where: { slug }, select: PUBLIC_SELECT });
  }

  /** Турнир служебного канала: сам турнир, турнир ковра или схватки (сначала — вход, потом поиск). */
  private async competitionOf(
    who: Subscriber,
    channel: Extract<ParsedLiveChannel, { kind: 'ops:competition' | 'ops:mat' | 'ops:match' }>,
  ): Promise<string> {
    this.requireUser(who);
    if (channel.kind === 'ops:competition') return channel.competitionId;
    const row =
      channel.kind === 'ops:mat'
        ? await this.db.mat.findUnique({ where: { id: channel.matId }, select: { competitionId: true } })
        : await this.db.match.findUnique({ where: { id: channel.matchId }, select: { competitionId: true } });
    if (!row) throw new LiveDenied('NOT_FOUND');
    return row.competitionId;
  }

  /**
   * Снимок канала состояния: сохранённое последнее состояние или посчитанное сейчас (с номером последнего
   * сообщения — следующее живое сообщение продолжит последовательность). Состояния нет — канал не найден.
   */
  async snapshot(
    grant: ChannelGrant,
    channel: string,
  ): Promise<{ seq: number; snapshot: LiveMessage | null }> {
    const { seq, last } = await this.publisher.state(grant.room);
    if (!grant.state) return { seq, snapshot: null };
    if (last) return { seq: Math.max(seq, last.seq), snapshot: last };
    const pending = this.inflight.get(grant.room);
    const computing =
      pending ??
      (async () => {
        const payload = await grant.state?.compute();
        if (!payload) return null;
        const message: LiveMessage = {
          v: 1,
          channel,
          seq,
          type: grant.state?.type ?? 'changed',
          occurredAt: new Date().toISOString(),
          payload,
        };
        await this.publisher.retainIfAbsent(grant.room, message);
        return message;
      })().finally(() => this.inflight.delete(grant.room));
    if (!pending) this.inflight.set(grant.room, computing);
    const message = await computing;
    if (!message) throw new LiveDenied('NOT_FOUND');
    return { seq: Math.max(seq, message.seq), snapshot: message };
  }

  /** Турнир опубликован и не удалён; иначе — как будто канала нет (NOT_FOUND). */
  private async assertPublic(
    key: string,
    load: () => Promise<{ status: string; deletedAt: Date | null } | null>,
  ): Promise<void> {
    const now = Date.now();
    let hit = this.publicCache.get(key);
    if (!hit || now - hit.at > PUBLIC_CACHE_MS) {
      hit = { at: now, value: load().then((c) => c !== null && isPublicCompetition(c)) };
      this.publicCache.delete(key);
      this.publicCache.set(key, hit);
      if (this.publicCache.size > PUBLIC_CACHE_MAX) {
        const oldest = this.publicCache.keys().next().value;
        if (oldest !== undefined) this.publicCache.delete(oldest);
      }
      hit.value.catch(() => this.publicCache.delete(key));
    }
    if (!(await hit.value)) throw new LiveDenied('NOT_FOUND');
  }

  private requireUser(who: Subscriber): AuthUser {
    if (!who.user) throw new LiveDenied(who.authError ?? 'UNAUTHENTICATED');
    return who.user;
  }

  private async assertStaff(who: Subscriber, competitionId: string): Promise<void> {
    const user = this.requireUser(who);
    const exists = await this.db.competition.findUnique({
      where: { id: competitionId },
      select: { id: true },
    });
    if (!exists) throw new LiveDenied('NOT_FOUND');
    const scope = await this.competitions.scopeOf(competitionId);
    if (!(await this.policy.can(user, 'competition.view', scope))) throw new LiveDenied('FORBIDDEN');
  }
}
