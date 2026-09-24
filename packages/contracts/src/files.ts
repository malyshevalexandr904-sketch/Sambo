// files (API.md, 3.5; ARCHITECTURE.md, 18; ADR-14).
import { z } from 'zod';

export const FILE_BUCKETS = ['PUBLIC_MEDIA', 'PRIVATE_DOCUMENTS', 'GENERATED'] as const;
export type FileBucket = (typeof FILE_BUCKETS)[number];

export const FILE_STATUSES = ['PENDING_UPLOAD', 'AVAILABLE', 'REJECTED', 'DELETED'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const UPLOAD_PURPOSES = [
  'ORGANIZATION_LOGO',
  'COMPETITION_LOGO',
  'REGULATION',
  'DOCUMENT',
  'CONSENT_SCAN',
  'IMPORT',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const MB = 1024 * 1024;

export interface UploadPolicy {
  bucket: FileBucket;
  mimeTypes: readonly string[];
  maxSizeBytes: number;
}

/**
 * Лимиты по цели загрузки. Для DOCUMENT и CONSENT_SCAN окончательный лимит — из DocumentType (Phase 3).
 * SVG и HTML не принимаются никогда (XSS).
 */
export const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
  ORGANIZATION_LOGO: {
    bucket: 'PUBLIC_MEDIA',
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxSizeBytes: 2 * MB,
  },
  COMPETITION_LOGO: {
    bucket: 'PUBLIC_MEDIA',
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxSizeBytes: 2 * MB,
  },
  REGULATION: { bucket: 'PUBLIC_MEDIA', mimeTypes: ['application/pdf'], maxSizeBytes: 20 * MB },
  DOCUMENT: {
    bucket: 'PRIVATE_DOCUMENTS',
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxSizeBytes: 10 * MB,
  },
  CONSENT_SCAN: {
    bucket: 'PRIVATE_DOCUMENTS',
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxSizeBytes: 10 * MB,
  },
  IMPORT: {
    bucket: 'PRIVATE_DOCUMENTS',
    mimeTypes: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    maxSizeBytes: 5 * MB,
  },
};

export const UploadRequest = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, { error: 'invalid_sha256' }),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  fields: Record<string, string>;
  expiresAt: string;
}

export interface StoredFileDto {
  id: string;
  bucket: FileBucket;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: FileStatus;
  createdAt: string;
  publicUrl: string | null;
}

export interface DownloadUrl {
  url: string;
  expiresAt: string;
}
