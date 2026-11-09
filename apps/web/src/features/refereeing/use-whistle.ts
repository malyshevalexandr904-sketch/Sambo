'use client';
// Микрофон ноутбука руководителя ковра → распознавание свистка (whistle-detect.ts). Режим включает руководитель
// ковра; включение и настройка хранятся в браузере этого устройства. Шумоподавление и автоусиление браузера
// выключены: они глушат как раз ровный тон свистка.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalibrationRecorder,
  DEFAULT_PROFILE,
  type FrameStats,
  type Sensitivity,
  type WhistleProfile,
  detectorFor,
  frameStats,
  profileFrom,
} from './whistle-detect';

const STORAGE_KEY = 'sde.whistle.v1';
const FRAME_MS = 20;
const CALIBRATION_MS = 8000;

interface Stored {
  enabled: boolean;
  sensitivity: Sensitivity;
  profile: WhistleProfile | null;
}

const DEFAULTS: Stored = { enabled: false, sensitivity: 'medium', profile: null };

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Stored>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function save(s: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // без хранилища режим просто не запомнится
  }
}

export type MicStatus = 'off' | 'starting' | 'listening' | 'denied' | 'unsupported';
export type Calibration = { phase: 'idle' } | { phase: 'recording'; count: number } | { phase: 'failed' };

interface MicSinks {
  status: (s: MicStatus) => void;
  level: (v: number) => void;
  whistle: () => void;
  recorder: () => CalibrationRecorder | null;
}

/** Подключает микрофон и разбирает кадры каждые 20 мс; возвращает отключение. */
export function openMic(profile: WhistleProfile, sensitivity: Sensitivity, sink: MicSinks): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    sink.status('unsupported');
    return () => undefined;
  }
  let cancelled = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  sink.status('starting');
  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      if (!cancelled) sink.status('denied');
      return;
    }
    if (cancelled) {
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    const audio = new AudioContext();
    ctx = audio;
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    audio.createMediaStreamSource(stream).connect(analyser);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const detector = detectorFor(profile, sensitivity);
    const quiet = profile.levelDb - 40;
    let lastLevelAt = 0;
    sink.status('listening');
    timer = setInterval(() => {
      analyser.getFloatFrequencyData(spectrum);
      const t = performance.now();
      const rec = sink.recorder();
      if (rec) {
        rec.push(frameStats(spectrum, audio.sampleRate, CalibrationRecorder.BAND), t);
        return;
      }
      const stats: FrameStats = frameStats(spectrum, audio.sampleRate, profile);
      if (detector.push(stats, t)) sink.whistle();
      if (t - lastLevelAt > 100) {
        lastLevelAt = t;
        // индикатор: 0 — тишина, 1 — громкость настроенного свистка
        const v = Number.isFinite(stats.peakDb) ? (stats.peakDb - quiet) / (profile.levelDb - quiet) : 0;
        sink.level(Math.max(0, Math.min(1, v)) * Math.min(1, stats.bandShare / 0.55));
      }
    }, FRAME_MS);
  })();
  return () => {
    cancelled = true;
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach((tr) => tr.stop());
    void ctx?.close();
  };
}

export function useWhistle(onWhistle: () => void) {
  const [stored, setStored] = useState<Stored>(DEFAULTS);
  const [status, setStatus] = useState<MicStatus>('off');
  const [level, setLevel] = useState(0);
  const [calibration, setCalibration] = useState<Calibration>({ phase: 'idle' });
  const onWhistleRef = useRef(onWhistle);
  onWhistleRef.current = onWhistle;
  const recorder = useRef<CalibrationRecorder | null>(null);

  useEffect(() => setStored(load()), []);

  const update = useCallback((patch: Partial<Stored>) => {
    setStored((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const listen = stored.enabled || calibration.phase === 'recording';
  const profile = stored.profile ?? DEFAULT_PROFILE;
  const { sensitivity } = stored;

  useEffect(() => {
    if (!listen) {
      setStatus('off');
      setLevel(0);
      return;
    }
    return openMic(profile, sensitivity, {
      status: setStatus,
      level: setLevel,
      whistle: () => onWhistleRef.current(),
      recorder: () => recorder.current,
    });
  }, [listen, profile, sensitivity]);

  // Настройка: 8 секунд записи, арбитр дует 2–3 раза.
  const recording = calibration.phase === 'recording';
  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => {
      const n = recorder.current?.samples.length ?? 0;
      setCalibration((c) =>
        c.phase === 'recording' && c.count !== n ? { phase: 'recording', count: n } : c,
      );
    }, 200);
    const done = setTimeout(() => {
      const result = profileFrom(recorder.current?.samples ?? []);
      recorder.current = null;
      if (result) {
        update({ profile: result, enabled: true });
        setCalibration({ phase: 'idle' });
      } else setCalibration({ phase: 'failed' });
    }, CALIBRATION_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [recording, update]);

  const calibrate = useCallback(() => {
    recorder.current = new CalibrationRecorder();
    setCalibration({ phase: 'recording', count: 0 });
  }, []);

  return {
    enabled: stored.enabled,
    setEnabled: (enabled: boolean) => update({ enabled }),
    sensitivity,
    setSensitivity: (s: Sensitivity) => update({ sensitivity: s }),
    calibrated: stored.profile !== null,
    profile: stored.profile,
    status,
    level,
    calibration,
    calibrate,
  };
}
