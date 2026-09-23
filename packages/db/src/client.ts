import { type Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient;
/** Клиент внутри интерактивной транзакции. */
export type Tx = Prisma.TransactionClient;

export interface CreatePrismaClientOptions {
  url: string;
  log?: Prisma.LogLevel[];
}

export function createPrismaClient({
  url,
  log = ['warn', 'error'],
}: CreatePrismaClientOptions): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log });
}
