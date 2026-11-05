// Ответ с PDF положения: просмотр во встроенном окне страницы турнира (inline) или скачивание (`?download=1`).
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { RegulationPdf } from '../application/regulation-document.service';

export const RegulationPdfQuery = z.object({ download: z.enum(['1', 'true']).optional() });
export type RegulationPdfQuery = z.infer<typeof RegulationPdfQuery>;

export function regulationPdfResponse(
  res: Response,
  pdf: RegulationPdf,
  q: RegulationPdfQuery,
  cacheControl: string,
): StreamableFile {
  const disposition = q.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${pdf.fileName}"; filename*=UTF-8''${encodeURIComponent(pdf.fileNameRu)}`,
  );
  res.setHeader('Content-Length', String(pdf.content.length));
  res.setHeader('Cache-Control', cacheControl);
  // Общий CSP API запрещает встраивание (frame-ancestors 'none'); положение показывается во фрейме своего сайта.
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  return new StreamableFile(pdf.content);
}
