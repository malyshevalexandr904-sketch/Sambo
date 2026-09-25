// Документы (API.md, 4.6; DATABASE.md, 3.5; ARCHITECTURE.md, 16.4).
import { z } from 'zod';
import { LocalDate, PageQuery, Reason, Uuid } from './common.js';

export const DOCUMENT_STATUSES = ['UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Владелец документа — ровно один: спортсмен, заявка (Phase 4) или организация. */
export const DocumentOwner = z
  .object({ athleteId: Uuid.optional(), applicationId: Uuid.optional(), organizationId: Uuid.optional() })
  .refine((o) => [o.athleteId, o.applicationId, o.organizationId].filter(Boolean).length === 1, {
    error: 'exactly_one_owner',
  });
export type DocumentOwner = z.infer<typeof DocumentOwner>;

export const DocumentCreate = z.object({
  typeCode: z.string().regex(/^[A-Z0-9_-]{2,40}$/, { error: 'invalid_code' }),
  fileId: Uuid,
  owner: DocumentOwner,
  /** Контекст турнира, для которого загружен документ. */
  competitionId: Uuid.optional(),
  expirationDate: LocalDate.optional(),
});
export type DocumentCreate = z.infer<typeof DocumentCreate>;

export const DocumentsQuery = PageQuery.extend({
  athleteId: Uuid.optional(),
  organizationId: Uuid.optional(),
  competitionId: Uuid.optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  typeCode: z.string().max(40).optional(),
});
export type DocumentsQuery = z.infer<typeof DocumentsQuery>;

export const DOCUMENT_REVIEW_TARGETS = ['UNDER_REVIEW', 'VERIFIED', 'REJECTED'] as const;

export const DocumentTransitionRequest = z.object({
  to: z.enum(DOCUMENT_REVIEW_TARGETS),
  reason: Reason.optional(),
});
export type DocumentTransitionRequest = z.infer<typeof DocumentTransitionRequest>;

export type DocumentOwnerDto =
  | { type: 'ATHLETE'; athleteId: string; name: string }
  | { type: 'ORGANIZATION'; organizationId: string; name: string }
  | { type: 'APPLICATION'; applicationId: string };

export interface DocumentDto {
  id: string;
  typeCode: string;
  owner: DocumentOwnerDto;
  competitionId: string | null;
  status: DocumentStatus;
  expirationDate: string | null;
  file: { id: string; originalName: string; mimeType: string; sizeBytes: number };
  uploadedAt: string;
  uploadedBy: { id: string; displayName: string } | null;
  reviewedAt: string | null;
  reviewedBy: { id: string; displayName: string } | null;
  rejectReason: string | null;
  version: number;
  allowedActions: string[];
}
