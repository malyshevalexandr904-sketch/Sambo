// Медицинский допуск (API.md, 5.7; DATABASE.md, 3.5; G-05, часть 1): факт, срок, кто выдал — без диагнозов.
// Сведения видит только медицинский персонал турнира; секретарь и судьи — лишь итог проверки MEDICAL.
import { z } from 'zod';
import type { AthleteBrief } from './admission.js';
import { LocalDate, PageQuery, Reason, Uuid } from './common.js';
import type { OrganizationRef } from './organizations.js';

export const MEDICAL_CLEARANCE_STATUSES = ['VALID', 'REVOKED'] as const;
export type MedicalClearanceStatus = (typeof MEDICAL_CLEARANCE_STATUSES)[number];

/** Состояние спортсмена на турнире: действующий допуск, отозван, нет. */
export const MEDICAL_STATES = ['VALID', 'REVOKED', 'MISSING'] as const;
export type MedicalState = (typeof MEDICAL_STATES)[number];

export const MedicalClearanceCreate = z.object({
  athleteId: Uuid,
  validUntil: LocalDate,
  issuedBy: z.string().trim().min(2).max(200),
  documentId: Uuid.optional(),
  /** Допуск только на этот турнир; иначе — на период до `validUntil`. */
  competitionOnly: z.boolean().default(false),
});
export type MedicalClearanceCreate = z.infer<typeof MedicalClearanceCreate>;

export const MedicalClearanceRevoke = z.object({ reason: Reason });
export type MedicalClearanceRevoke = z.infer<typeof MedicalClearanceRevoke>;

export const MedicalQuery = PageQuery.extend({
  state: z.enum(MEDICAL_STATES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type MedicalQuery = z.infer<typeof MedicalQuery>;

export interface MedicalClearanceDto {
  id: string;
  athleteId: string;
  competitionId: string | null;
  validUntil: string;
  issuedBy: string;
  documentId: string | null;
  status: MedicalClearanceStatus;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface MedicalRow {
  athlete: AthleteBrief;
  organizations: OrganizationRef[];
  state: MedicalState;
  /** Действующий допуск на дату начала турнира, иначе последний отозванный. */
  clearance: MedicalClearanceDto | null;
}
