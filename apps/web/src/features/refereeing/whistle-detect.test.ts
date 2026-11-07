import { describe, expect, it } from 'vitest';
import {
  CalibrationRecorder,
  DEFAULT_PROFILE,
  WhistleDetector,
  frameStats,
  profileFrom,
} from './whistle-detect';

const RATE = 48_000;
const BINS = 1024;
const BIN_HZ = RATE / 2 / BINS;

/** Спектр: фон floorDb и тоны {hz: дБ} (тон занимает 3 соседних отсчёта). */
function spectrum(floorDb: number, tones: Record<number, number> = {}): Float32Array {
  const s = new Float32Array(BINS).fill(floorDb);
  for (const [hz, db] of Object.entries(tones)) {
    const bin = Math.round(Number(hz) / BIN_HZ);
    s[bin] = db;
    s[bin - 1] = db - 6;
    s[bin + 1] = db - 6;
  }
  return s;
}

const whistle = (db = -20) => frameStats(spectrum(-90, { 3000: db }), RATE, DEFAULT_PROFILE);
const silence = () => frameStats(spectrum(-90), RATE, DEFAULT_PROFILE);

/** Прогон кадров по 20 мс; возвращает моменты срабатываний. */
function run(
  detector: WhistleDetector,
  frames: { ms: number; frame: () => ReturnType<typeof whistle> }[],
): number[] {
  const fired: number[] = [];
  let t = 0;
  for (const { ms, frame } of frames) {
    for (let end = t + ms; t < end; t += 20) if (detector.push(frame(), t)) fired.push(t);
  }
  return fired;
}

describe('frameStats', () => {
  it('a whistle puts almost all energy into its band', () => {
    const s = whistle();
    expect(s.peakHz).toBeGreaterThan(2950);
    expect(s.peakHz).toBeLessThan(3050);
    expect(s.bandShare).toBeGreaterThan(0.9);
  });

  it('crowd noise spread over the spectrum has a small band share', () => {
    const s = frameStats(spectrum(-30), RATE, DEFAULT_PROFILE);
    expect(s.bandShare).toBeLessThan(0.4);
  });

  it('a voice (low tones) is not a whistle', () => {
    const s = frameStats(spectrum(-90, { 200: -15, 400: -18, 800: -20 }), RATE, DEFAULT_PROFILE);
    expect(s.bandShare).toBeLessThan(0.1);
  });
});

describe('WhistleDetector', () => {
  it('fires once per whistle, after it has sounded long enough', () => {
    const d = new WhistleDetector({ minDb: -40 });
    const fired = run(d, [
      { ms: 200, frame: silence },
      { ms: 1000, frame: () => whistle() },
      { ms: 200, frame: silence },
    ]);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(200 + 120);
  });

  it('ignores a short chirp and a quiet whistle from a neighbouring mat', () => {
    const d = new WhistleDetector({ minDb: -40 });
    expect(
      run(d, [
        { ms: 80, frame: () => whistle() },
        { ms: 200, frame: silence },
      ]),
    ).toHaveLength(0);
    expect(run(d, [{ ms: 600, frame: () => whistle(-55) }])).toHaveLength(0);
  });

  it('ignores loud broadband noise', () => {
    const d = new WhistleDetector({ minDb: -40 });
    expect(
      run(d, [{ ms: 1000, frame: () => frameStats(spectrum(-20), RATE, DEFAULT_PROFILE) }]),
    ).toHaveLength(0);
  });

  it('does not count a second whistle within 1.5 s', () => {
    const d = new WhistleDetector({ minDb: -40 });
    const fired = run(d, [
      { ms: 300, frame: () => whistle() },
      { ms: 400, frame: silence },
      { ms: 300, frame: () => whistle() }, // ~0.7 с после первого — не считается
      { ms: 1500, frame: silence },
      { ms: 300, frame: () => whistle() },
    ]);
    expect(fired).toHaveLength(2);
  });

  it('a short dropout inside one whistle does not split it', () => {
    const d = new WhistleDetector({ minDb: -40, refractoryMs: 0 });
    const fired = run(d, [
      { ms: 200, frame: () => whistle() },
      { ms: 40, frame: silence },
      { ms: 200, frame: () => whistle() },
    ]);
    expect(fired).toHaveLength(1);
  });
});

describe('calibration', () => {
  it('learns the band and level of the whistle', () => {
    const rec = new CalibrationRecorder();
    const frame = (hz: number | null) =>
      frameStats(spectrum(-90, hz ? { [hz]: -25 } : {}), RATE, CalibrationRecorder.BAND);
    let t = 0;
    const feed = (ms: number, hz: number | null) => {
      for (let end = t + ms; t < end; t += 20) rec.push(frame(hz), t);
    };
    feed(600, null);
    for (let i = 0; i < 3; i++) {
      feed(400, 3200);
      feed(500, null);
    }
    expect(rec.samples).toHaveLength(3);
    const p = profileFrom(rec.samples);
    expect(p).not.toBeNull();
    expect(p!.lowHz).toBeLessThan(3200);
    expect(p!.highHz).toBeGreaterThan(3200);
    expect(p!.levelDb).toBeLessThanOrEqual(-24);
    expect(profileFrom([])).toBeNull();
  });
});
