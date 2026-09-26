// Право записи турнира (ADR-21; ARCHITECTURE.md, 15.1). Чистые функции без NestJS и Prisma.

export type DeploymentMode = 'cloud' | 'venue-node';

export interface LeaseState {
  holderType: 'CLOUD' | 'NODE';
  holderNodeId: string | null;
  epoch: number;
}

export interface Instance {
  mode: DeploymentMode;
  /** Идентификатор узла — только в режиме площадочного узла (Phase 9.5). */
  nodeId: string | null;
}

/**
 * Может ли этот экземпляр писать операционные данные турнира. Облако пишет, пока право у облака;
 * узел — только турнир, право на который выдано именно ему. Нет записи о праве — турнир в облаке.
 */
export function holdsWriteAuthority(lease: LeaseState | null, instance: Instance): boolean {
  if (!lease) return instance.mode === 'cloud';
  if (instance.mode === 'cloud') return lease.holderType === 'CLOUD';
  return lease.holderType === 'NODE' && lease.holderNodeId !== null && lease.holderNodeId === instance.nodeId;
}
