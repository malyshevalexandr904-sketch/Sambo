// OrganizationClosure (DATABASE.md, 3.2): права федерации на всё поддерево одним запросом.
// Поддерживается только этим репозиторием; циклы запрещены.
import { Injectable } from '@nestjs/common';
import type { Tx } from '@sde/db';

@Injectable()
export class ClosureRepository {
  /** Строки для новой организации: (self, self, 0) и (предок родителя, новая, depth + 1). */
  async insertNode(tx: Tx, id: string, parentId: string | null): Promise<void> {
    await tx.$executeRaw`INSERT INTO organization_closure (ancestor_id, descendant_id, depth) VALUES (${id}::uuid, ${id}::uuid, 0)`;
    if (parentId) {
      await tx.$executeRaw`
        INSERT INTO organization_closure (ancestor_id, descendant_id, depth)
        SELECT ancestor_id, ${id}::uuid, depth + 1 FROM organization_closure WHERE descendant_id = ${parentId}::uuid`;
    }
  }

  /** Предки, включая саму организацию, от ближайшего к корню. */
  async ancestors(tx: Pick<Tx, '$queryRaw'>, id: string): Promise<string[]> {
    const rows = await tx.$queryRaw<{ ancestor_id: string }[]>`
      SELECT ancestor_id FROM organization_closure WHERE descendant_id = ${id}::uuid ORDER BY depth`;
    return rows.map((r) => r.ancestor_id);
  }

  async isDescendant(tx: Tx, candidate: string, of: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM organization_closure WHERE ancestor_id = ${of}::uuid AND descendant_id = ${candidate}::uuid LIMIT 1`;
    return rows.length > 0;
  }

  /**
   * Перенос поддерева под нового родителя: удаляются связи поддерева со старыми предками
   * и добавляются связи с новыми. Вызывающий обязан заранее проверить отсутствие цикла.
   */
  async move(tx: Tx, id: string, newParentId: string | null): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM organization_closure c
      USING organization_closure sub, organization_closure sup
      WHERE sub.ancestor_id = ${id}::uuid
        AND sup.descendant_id = ${id}::uuid AND sup.ancestor_id <> ${id}::uuid
        AND c.descendant_id = sub.descendant_id AND c.ancestor_id = sup.ancestor_id`;
    if (newParentId) {
      await tx.$executeRaw`
        INSERT INTO organization_closure (ancestor_id, descendant_id, depth)
        SELECT sup.ancestor_id, sub.descendant_id, sup.depth + sub.depth + 1
        FROM organization_closure sup, organization_closure sub
        WHERE sup.descendant_id = ${newParentId}::uuid AND sub.ancestor_id = ${id}::uuid`;
    }
  }

  /** Участники организации (для увеличения permissionsVersion при смене статуса). */
  async memberUserIds(tx: Tx, organizationIds: string[]): Promise<string[]> {
    const rows = await tx.organizationMembership.findMany({
      where: { organizationId: { in: organizationIds }, userId: { not: null } },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.map((r) => r.userId).filter((v): v is string => v !== null);
  }
}
