// Распознавание свистка арбитра по спектру звука (идея 07.11.2026: свисток запускает и останавливает время).
// Свисток — громкий почти чистый тон 2–4 кГц: в кадре спектра почти вся энергия речевого диапазона лежит в узкой
// полосе вокруг его частоты. Голоса, хлопки и шум зала размазаны по спектру, поэтому доля полосы у них мала.
// Чистые функции без Web Audio — их проверяют тесты; микрофон подключает use-whistle.ts.

/** Полоса частот свистка, Гц. */
export interface WhistleBand {
  lowHz: number;
  highHz: number;
}

/** Настройка под конкретный свисток: полоса и громкость, с которой его слышит этот ноутбук. */
export interface WhistleProfile extends WhistleBand {
  /** Уровень пика при настройке, дБ (шкала AnalyserNode, 0 — максимум). */
  levelDb: number;
}

/** Без настройки: типичные свистки судей — 2–4,5 кГц. */
export const DEFAULT_PROFILE: WhistleProfile = { lowHz: 1800, highHz: 4500, levelDb: -30 };

/** Чувствительность: насколько тише уровня настройки свисток ещё засчитывается, дБ. */
export const SENSITIVITY_DB = { low: 6, medium: 12, high: 18 } as const;
export type Sensitivity = keyof typeof SENSITIVITY_DB;

/** Широкий диапазон, против которого считается доля полосы свистка. */
const REFERENCE_LOW_HZ = 300;
const REFERENCE_HIGH_HZ = 8000;

export interface FrameStats {
  /** Частота самого громкого отсчёта в полосе, Гц. */
  peakHz: number;
  /** Его уровень, дБ. */
  peakDb: number;
  /** Доля энергии 300–8000 Гц, приходящаяся на полосу (0…1). */
  bandShare: number;
}

/** Разбор одного кадра спектра (getFloatFrequencyData: дБ по отсчётам 0…sampleRate/2). */
export function frameStats(spectrumDb: ArrayLike<number>, sampleRate: number, band: WhistleBand): FrameStats {
  const binHz = sampleRate / 2 / spectrumDb.length;
  let total = 0;
  let inBand = 0;
  let peakDb = -Infinity;
  let peakBin = 0;
  const from = Math.max(1, Math.floor(REFERENCE_LOW_HZ / binHz));
  const to = Math.min(spectrumDb.length - 1, Math.ceil(REFERENCE_HIGH_HZ / binHz));
  for (let i = from; i <= to; i++) {
    const db = spectrumDb[i] ?? -Infinity;
    if (!Number.isFinite(db)) continue;
    const power = 10 ** (db / 10);
    total += power;
    const hz = i * binHz;
    if (hz >= band.lowHz && hz <= band.highHz) {
      inBand += power;
      if (db > peakDb) {
        peakDb = db;
        peakBin = i;
      }
    }
  }
  return { peakHz: peakBin * binHz, peakDb, bandShare: total > 0 ? inBand / total : 0 };
}

export interface DetectorOptions {
  /** Минимальный уровень пика, дБ. */
  minDb: number;
  /** Минимальная доля полосы. */
  minShare?: number;
  /** Сколько звук должен длиться, чтобы считаться свистком, мс. */
  minMs?: number;
  /** Провал внутри свистка, который ещё не обрывает его, мс. */
  gapMs?: number;
  /** Повторный свисток раньше этого срока после срабатывания не считается, мс. */
  refractoryMs?: number;
}

export const REFRACTORY_MS = 1500;

/** Свисток засчитывается один раз — когда звучит дольше minMs; длинный свисток не срабатывает дважды. */
export class WhistleDetector {
  private runStart: number | null = null;
  private lastHit = -Infinity;
  private firedInRun = false;
  private lastFire = -Infinity;
  private readonly minShare: number;
  private readonly minMs: number;
  private readonly gapMs: number;
  private readonly refractoryMs: number;

  constructor(private readonly opts: DetectorOptions) {
    this.minShare = opts.minShare ?? 0.55;
    this.minMs = opts.minMs ?? 120;
    this.gapMs = opts.gapMs ?? 60;
    this.refractoryMs = opts.refractoryMs ?? REFRACTORY_MS;
  }

  /** Кадр в момент t (мс); true — свисток. */
  push(stats: FrameStats, t: number): boolean {
    const hit = stats.peakDb >= this.opts.minDb && stats.bandShare >= this.minShare;
    if (!hit) {
      if (this.runStart !== null && t - this.lastHit > this.gapMs) {
        this.runStart = null;
        this.firedInRun = false;
      }
      return false;
    }
    this.lastHit = t;
    if (this.runStart === null) this.runStart = t;
    if (this.firedInRun || t - this.runStart < this.minMs || t - this.lastFire < this.refractoryMs)
      return false;
    this.firedInRun = true;
    this.lastFire = t;
    return true;
  }
}

export const detectorFor = (profile: WhistleProfile, sensitivity: Sensitivity): WhistleDetector =>
  new WhistleDetector({ minDb: profile.levelDb - SENSITIVITY_DB[sensitivity] });

/** Один свисток при настройке: средняя частота и наибольший уровень. */
export interface CalibrationSample {
  hz: number;
  db: number;
}

/**
 * Записывает свистки при настройке: в широкой полосе 1–6 кГц ищет громкие тоны длиннее 150 мс. Порог — на 20 дБ
 * выше фонового шума, замеренного в первые полсекунды.
 */
export class CalibrationRecorder {
  readonly samples: CalibrationSample[] = [];
  private noise: number[] = [];
  private started: number | null = null;
  private run: { hz: number[]; db: number; start: number; last: number } | null = null;
  static readonly BAND: WhistleBand = { lowHz: 1000, highHz: 6000 };

  push(stats: FrameStats, t: number): void {
    if (this.started === null) this.started = t;
    if (t - this.started < 500) {
      if (Number.isFinite(stats.peakDb)) this.noise.push(stats.peakDb);
      return;
    }
    const floor = this.noise.length ? Math.max(...this.noise) : -90;
    const hit = stats.peakDb >= floor + 20 && stats.bandShare >= 0.5;
    if (hit) {
      if (!this.run) this.run = { hz: [], db: -Infinity, start: t, last: t };
      this.run.hz.push(stats.peakHz);
      this.run.db = Math.max(this.run.db, stats.peakDb);
      this.run.last = t;
      return;
    }
    if (this.run && t - this.run.last > 80) {
      if (this.run.last - this.run.start >= 150)
        this.samples.push({ hz: median(this.run.hz), db: this.run.db });
      this.run = null;
    }
  }
}

/** Профиль по записанным свисткам: полоса вокруг средней частоты (у свистков без шарика 2–3 близких тона). */
export function profileFrom(samples: readonly CalibrationSample[]): WhistleProfile | null {
  if (samples.length === 0) return null;
  const hz = median(samples.map((s) => s.hz));
  const levelDb = Math.min(...samples.map((s) => s.db));
  return { lowHz: Math.round(hz * 0.75), highHz: Math.round(hz * 1.35), levelDb: Math.round(levelDb) };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
