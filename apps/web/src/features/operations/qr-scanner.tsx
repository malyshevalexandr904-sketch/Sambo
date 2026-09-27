'use client';
// Сканер QR с камеры планшета (IMPLEMENTATION_PLAN, Phase 4): BarcodeDetector, где он есть (Chrome, Android),
// иначе jsQR по кадрам с камеры. Код можно ввести и вручную. Сканер только читает токен — решение за человеком.
import { Alert, Button, Field, Input } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

type DetectorConstructor = new (opts: { formats: string[] }) => Detector;

async function frameDecoder(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  const Native = (globalThis as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (Native) {
    const detector = new Native({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height)?.data ?? null;
  };
}

export function QrScanner({ onToken, busy }: { onToken: (token: string) => void; busy?: boolean }) {
  const t = useTranslations('checkin');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [manual, setManual] = useState('');

  const stop = (): void => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setActive(false);
  };

  useEffect(() => stop, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const decode = await frameDecoder();
      const tick = async (): Promise<void> => {
        if (cancelled || !video.current) return;
        const value = await decode(video.current).catch(() => null);
        if (value && !cancelled) {
          stop();
          onToken(value);
          return;
        }
        timer = setTimeout(() => void tick(), 300);
      };
      void tick();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, onToken]);

  const start = async (): Promise<void> => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setUnavailable(false);
      setActive(true);
    } catch {
      setUnavailable(true);
      stop();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{t('scanHint')}</p>
      <video
        ref={video}
        className={active ? 'aspect-video w-full max-w-md rounded-md bg-slate-900' : 'hidden'}
        muted
        playsInline
      />
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button variant="secondary" onClick={stop}>
            {t('stopCamera')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void start()}>
            {t('startCamera')}
          </Button>
        )}
      </div>
      {unavailable ? <Alert tone="warning">{t('cameraUnavailable')}</Alert> : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onToken(manual.trim());
        }}
      >
        <Field id="qr-manual" label={t('manualToken')} className="min-w-0 flex-1">
          <Input
            id="qr-manual"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoComplete="off"
            maxLength={300}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={!manual.trim()}>
          {t('find')}
        </Button>
      </form>
    </div>
  );
}
