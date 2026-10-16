// Запись перехода статуса заявки (Phase 9a): статус меняется только здесь — с проверкой версии и текущего статуса
// (два одновременных решения или повторная отправка — VERSION_CONFLICT) и строкой истории.
import type { OnboardingStatus } from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import { versionConflict } from '../../../common/errors/domain-error';

export async function writeTransition(
  tx: Tx,
  current: { id: string; status: OnboardingStatus; version: number },
  expectedVersion: number,
  to: OnboardingStatus,
  data: Prisma.OnboardingRequestUncheckedUpdateManyInput,
  actorUserId: string | null,
  reason: string | null,
): Promise<void> {
  const { count } = await tx.onboardingRequest.updateMany({
    where: { id: current.id, version: expectedVersion, status: current.status },
    data: { ...data, status: to, version: { increment: 1 } },
  });
  if (count === 0) throw versionConflict(current.version);
  await tx.onboardingStatusChange.create({
    data: {
      id: uuidv7(),
      requestId: current.id,
      fromStatus: current.status,
      toStatus: to,
      actorUserId,
      reason,
    },
  });
}
